import crypto from 'node:crypto';
import { db, type OrderRecord, type WhatsAppSessionRecord } from '@chhaap/db';
import { calculateOrderPricing, calculatePricing, DEFAULT_STANDARD_INDIAN_RATES } from '@chhaap/pricing';
import type { PrintSettings, WaSessionState, WaLanguage } from '@chhaap/shared';
import { PrintSettingsSchema } from '@chhaap/shared';
import { getWhatsAppProvider } from './index.js';
import { COPY } from './copy.js';
import { storage } from '../storage.js';
import { analyzeDocument } from '../document-processor.js';
import { gateway } from '../websocket-gateway.js';
import { paymentService } from '../payments.js';
import { loadConfig } from '../config.js';

export interface InboundMessageContext {
  from: string; // waId
  messageId: string;
  type: string;
  text?: string;
  document?: {
    id: string;
    mime_type: string;
    filename?: string;
  };
  image?: {
    id: string;
    mime_type: string;
  };
  interactiveReply?: {
    id: string;
    title: string;
  };
}

interface SessionContext {
  step?: 'language' | 'file' | 'color' | 'sides' | 'copies' | 'copies_other' | 'review';
  settings?: PrintSettings;
  fileId?: string;
  itemId?: string;
  orderId?: string;
  originalName?: string;
  pageCount?: number;
  perPageClassification?: Array<{ pageNumber: number; isColor: boolean }>;
  itemsSummary?: Array<{ name: string; pages: number; copies: number; mode: string; sides: string; linePaise: number }>;
  totalPaise?: number;
}

const DEFAULT_SETTINGS: PrintSettings = PrintSettingsSchema.parse({});

function emptySettings(): PrintSettings {
  return { ...DEFAULT_SETTINGS };
}

function money(paise: number): string {
  return (paise / 100).toFixed(2);
}

/**
 * Persistent WhatsApp conversation state machine. State, language, settings
 * and the current order live in the database, so an API restart does not lose
 * a conversation. Every branch is safe to replay for a duplicate webhook.
 */
export class ConversationManager {
  async handleInbound(msg: InboundMessageContext): Promise<void> {
    const waId = msg.from;
    const provider = getWhatsAppProvider();
    const rawText = (msg.text ?? '').trim();
    const command = rawText.toLowerCase();
    const selection = (msg.interactiveReply?.id ?? rawText).toLowerCase();

    // Opt-out handling is global and never depends on a session.
    if (await db.isOptedOut(waId)) {
      if (command === 'start') {
        await db.clearOptOut(waId);
        await provider.sendText(waId, COPY.hinglish.optedIn);
      }
      return;
    }
    if (command === 'stop') {
      await db.setOptOut(waId);
      await provider.sendText(waId, COPY.hinglish.optedOut);
      return;
    }

    if (command === 'help' || command === 'menu') {
      await provider.sendText(waId, COPY.hinglish.help);
      return;
    }

    if (command === 'print' || command.startsWith('print ')) {
      await this.handlePrintCommand(waId, rawText, msg);
      return;
    }

    if (await db.isOptedOut(waId)) return;
    let session = await db.getActiveWaSession(waId);

    if (command === 'cancel') {
      await this.cancelSession(waId, session, msg);
      return;
    }

    if (command === 'status') {
      await this.sendStatus(waId, session);
      return;
    }

    if (command === 'repeat') {
      await this.handleRepeat(waId, msg);
      return;
    }

    // No session: send the entry instructions. We cannot persist a language
    // preference before a shop is known (wa_sessions.shop_id is NOT NULL).
    if (!session) {
      await provider.sendText(
        waId,
        `Welcome to Chhaap! Scan the counter QR or send *PRINT <shopSlug>* (example: PRINT campus-xerox) to begin. Files are deleted automatically after printing.`
      );
      return;
    }

    this.touch(session);
    const copy = COPY[session.lang] ?? COPY.hinglish;
    const context = session.context as SessionContext;

    // Language choice is offered immediately after the shop is bound.
    if (selection === 'lang_en' || selection === 'lang_hi' || selection === 'lang_hinglish') {
      session.lang = selection.replace('lang_', '') as WaLanguage;
      context.step = 'file';
      await db.saveWaSession(session);
      await provider.sendText(waId, COPY[session.lang].languageSet);
      await provider.sendText(waId, COPY[session.lang].askFile);
      return;
    }

    if (command === 'pay') {
      await this.sendPaymentLink(session, waId, copy);
      return;
    }

    switch (session.state) {
      case 'AWAITING_FILE':
        await this.handleAwaitingFile(session, msg, waId, copy);
        return;

      case 'CONFIGURING':
        await this.handleConfiguring(session, selection, waId, copy);
        return;

      case 'REVIEW':
        await this.handleReviewReply(session, selection, waId, copy);
        return;

      case 'AWAITING_PAYMENT': {
        if (command === 'paid') {
          await provider.sendText(waId, copy.alreadyPaid);
          return;
        }
        if (selection === 'pay_now' || command === 'pay') {
          await this.sendPaymentLink(session, waId, copy);
          return;
        }
        await provider.sendText(waId, `${copy.alreadyPaid}\n\nType STATUS, PAY or CANCEL.`);
        return;
      }

      case 'TRACKING': {
        await this.sendStatus(waId, session);
        return;
      }

      default:
        await provider.sendText(waId, copy.noActiveOrder);
    }
  }

  private touch(session: WhatsAppSessionRecord): void {
    const ttl = loadConfig().sessionTtlMinutes;
    session.lastInboundAt = new Date().toISOString();
    session.expiresAt = new Date(Date.now() + ttl * 60 * 1000).toISOString();
  }

  // --------------------------------------------------------------------------
  // Entry / session lifecycle
  // --------------------------------------------------------------------------

  private async handlePrintCommand(
    waId: string,
    rawText: string,
    msg: InboundMessageContext
  ): Promise<void> {
    const provider = getWhatsAppProvider();
    const match = rawText.match(/^PRINT\s+([a-zA-Z0-9_-]+)/i);
    const slug = (match?.[1] ?? '').toLowerCase();
    if (!slug) {
      await provider.sendText(waId, 'Send PRINT <shopSlug>. Example: PRINT campus-xerox');
      return;
    }

    const shop = await db.getShopBySlug(slug);
    if (!shop) {
      await provider.sendText(
        waId,
        `Shop "${slug}" was not found. Please scan the QR code on the counter or check the shop slug.`
      );
      return;
    }

    if (shop.status !== 'active' || shop.settings.isOpen === false) {
      await provider.sendText(waId, COPY.hinglish.shopClosed(shop.name));
      return;
    }

    // Pre-flight: refuse before the customer uploads anything or pays.
    if (!(await gateway.shopCanAcceptOrders(shop.id))) {
      await provider.sendText(waId, COPY.hinglish.printerOffline(shop.name));
      return;
    }

    // Expire stale rows first: the DB has a unique partial index on active
    // sessions, so an old expired row must be closed before inserting a new one.
    await db.expireInactiveWaSessions(new Date());

    let existing = await db.getActiveWaSession(waId);
    if (existing && existing.shopId !== shop.id) {
      const order = existing.orderId ? await db.getOrderById(existing.orderId) : undefined;
      if (order && (order.status === 'draft' || order.status === 'awaiting_payment')) {
        await provider.sendText(
          waId,
          'You already have an order at another shop. Send CANCEL first, then PRINT again.'
        );
        return;
      }
      existing.state = 'DONE';
      await db.saveWaSession(existing);
      existing = undefined;
    }

    if (existing?.orderId) {
      const existingOrder = await db.getOrderById(existing.orderId);
      if (
        existingOrder &&
        ['draft', 'awaiting_payment', 'paid', 'queued', 'printing', 'completed'].includes(
          existingOrder.status
        )
      ) {
        if (['paid', 'queued', 'printing', 'completed'].includes(existingOrder.status)) {
          await this.sendStatus(waId, existing);
          return;
        }
        await provider.sendText(
          waId,
          `You already have an open order (token *${existingOrder.token}*). Send STATUS to check it or CANCEL to start over.`
        );
        return;
      }
    }

    const session: WhatsAppSessionRecord = existing ?? {
      id: crypto.randomUUID(),
      waId,
      shopId: shop.id,
      state: 'AWAITING_FILE' as WaSessionState,
      lang: 'hinglish',
      orderId: null,
      context: { step: 'language', settings: emptySettings() },
      lastInboundAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + loadConfig().sessionTtlMinutes * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString()
    };

    session.shopId = shop.id;
    session.state = 'AWAITING_FILE';
    session.orderId = null;
    session.context = {
      step: 'language',
      settings: emptySettings(),
      orderId: undefined
    } as SessionContext;
    this.touch(session);
    await db.saveWaSession(session);

    await provider.sendText(waId, COPY[session.lang].welcome(shop.name));
    await provider.sendButtons(waId, COPY[session.lang].chooseLanguage, [
      { id: 'lang_en', title: 'English' },
      { id: 'lang_hi', title: 'हिंदी' },
      { id: 'lang_hinglish', title: 'Hinglish' }
    ]);
    await provider.sendText(waId, COPY[session.lang].askFile);
    void msg;
  }

  private async handleRepeat(waId: string, msg: InboundMessageContext): Promise<void> {
    const provider = getWhatsAppProvider();
    const last = await db.getLastOrderByWaId(waId);
    if (!last) {
      await provider.sendText(waId, COPY.hinglish.noActiveOrder);
      return;
    }
    const items = await db.getOrderItemsByOrderId(last.id);
    const settings = items[0]?.settings ? { ...items[0].settings } : emptySettings();
    const shop = await db.getShopById(last.shopId);
    if (!shop || shop.status !== 'active' || shop.settings.isOpen === false) {
      await provider.sendText(waId, COPY.hinglish.shopClosed(shop?.name ?? 'the shop'));
      return;
    }
    if (!(await gateway.shopCanAcceptOrders(shop.id))) {
      await provider.sendText(waId, COPY.hinglish.printerOffline(shop.name));
      return;
    }

    await db.expireInactiveWaSessions(new Date());
    const existing = await db.getActiveWaSession(waId);
    if (existing) {
      existing.state = 'DONE';
      await db.saveWaSession(existing);
    }

    const session: WhatsAppSessionRecord = {
      id: crypto.randomUUID(),
      waId,
      shopId: shop.id,
      state: 'AWAITING_FILE',
      lang: existing?.lang ?? 'hinglish',
      orderId: null,
      context: { step: 'file', settings } as SessionContext,
      lastInboundAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + loadConfig().sessionTtlMinutes * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString()
    };
    await db.saveWaSession(session);
    await provider.sendText(
      waId,
      `Repeat order at *${shop.name}*: same settings (${settings.copies} copy, ${settings.colorMode}, ${settings.sides}).\n${COPY[session.lang].askFile}`
    );
    void msg;
  }

  private async cancelSession(
    waId: string,
    session: WhatsAppSessionRecord | undefined,
    msg: InboundMessageContext
  ): Promise<void> {
    const provider = getWhatsAppProvider();
    const copy = COPY[session?.lang ?? 'hinglish'];
    if (session) {
      if (session.orderId) {
        const order = await db.getOrderById(session.orderId);
        if (order) {
          if (order.status === 'draft') {
            await db.transitionOrderStatus(order.id, 'expired', { reason: 'customer_cancel' });
          } else if (order.status === 'awaiting_payment') {
            await db.transitionOrderStatus(order.id, 'expired', { reason: 'customer_cancel' });
          } else if (['paid', 'queued', 'printing'].includes(order.status)) {
            await paymentService.refundOrder(order.id, 'customer_cancel');
          }
        }
      }
      session.state = 'DONE';
      session.orderId = null;
      this.touch(session);
      await db.saveWaSession(session);
    }
    await provider.sendText(waId, copy.canceled);
    void msg;
  }

  private async sendStatus(
    waId: string,
    session: WhatsAppSessionRecord | undefined
  ): Promise<void> {
    const provider = getWhatsAppProvider();
    const copy = COPY[session?.lang ?? 'hinglish'];
    const order = session?.orderId
      ? await db.getOrderById(session.orderId)
      : await db.getLastOrderByWaId(waId);
    if (!order) {
      await provider.sendText(waId, copy.noActiveOrder);
      return;
    }
    await provider.sendText(waId, copy.statusLine(order.token, order.status, money(order.totalPaise)));
  }

  // --------------------------------------------------------------------------
  // AWAITING_FILE
  // --------------------------------------------------------------------------

  private async handleAwaitingFile(
    session: WhatsAppSessionRecord,
    msg: InboundMessageContext,
    waId: string,
    copy: (typeof COPY)[WaLanguage]
  ): Promise<void> {
    const provider = getWhatsAppProvider();
    const mediaId = msg.document?.id || msg.image?.id;

    if (!mediaId) {
      if (msg.interactiveReply?.id === 'add_file') {
        await provider.sendText(waId, copy.askFile);
        return;
      }
      await provider.sendText(waId, copy.askFile);
      return;
    }

    await provider.sendText(waId, 'File receive ho rahi hai, pages analyze kiye ja rahe hain...');

    try {
      const downloaded = await provider.downloadMedia(mediaId);
      const originalName =
        downloaded.filename ||
        msg.document?.filename ||
        (msg.type === 'image' ? 'whatsapp-image.jpg' : 'document.pdf');

      await this.processFile(session, waId, downloaded.buffer, originalName, copy, msg.messageId);
    } catch (err) {
      console.warn('[Conversation] File processing failed:', (err as Error).message);
      const reason = this.friendlyFileError((err as Error).message);
      await provider.sendText(waId, copy.invalidFile(reason));
      // State is intentionally unchanged so the customer can retry.
      await db.saveWaSession(session);
    }
  }

  private friendlyFileError(message: string): string | undefined {
    const known = [
      'Password-protected PDFs are not supported',
      'File exceeds the maximum allowed size',
      'Document has',
      'Unsupported file',
      'Unsupported file type',
      'Could not read the document',
      'ZIP archives are not accepted',
      'Office document conversion is not available'
    ];
    if (known.some((k) => message.includes(k))) return message.split('\n')[0];
    return undefined;
  }

  private async processFile(
    session: WhatsAppSessionRecord,
    waId: string,
    buffer: Buffer,
    originalName: string,
    copy: (typeof COPY)[WaLanguage],
    messageId: string
  ): Promise<void> {
    const provider = getWhatsAppProvider();
    const context = session.context as SessionContext;

    let order: OrderRecord | undefined = session.orderId
      ? await db.getOrderById(session.orderId)
      : undefined;

    if (!order) {
      order = await db.createOrder({
        shopId: session.shopId,
        customerWaId: waId,
        channel: 'whatsapp',
        idempotencyKey: `wa:${waId}:${messageId}`
      });
      session.orderId = order.id;
      context.orderId = order.id;
    }

    const existingItems = await db.getOrderItemsByOrderId(order.id);
    if (existingItems.length >= 5) {
      await provider.sendText(waId, copy.fileLimit);
      return;
    }

    const saved = await storage.saveBuffer(buffer, originalName);
    const fileRecord = await db.addFile({
      orderId: order.id,
      storageKey: saved.storageKey,
      originalName: saved.originalName,
      mime: saved.mime,
      sizeBytes: saved.sizeBytes,
      sha256: saved.sha256,
      scanStatus: 'clean',
      convertedPdfKey: saved.storageKey,
      previewKeys: [],
      pageCount: 1,
      classification: [],
      deleteAfter: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      deletedAt: null
    });

    try {
      const analysis = await analyzeDocument(
        saved.filePath,
        saved.originalName,
        storage.getPreviewsPath(),
        fileRecord.id,
        { maxPages: loadConfig().maxPages }
      );

      const committed = await storage.commitPrintedPdf(
        saved,
        analysis.printedPdfPath,
        analysis.printedSha256,
        analysis.printedSizeBytes
      );

      await db.updateFile(fileRecord.id, {
        orderId: order.id,
        storageKey: committed.storageKey,
        mime: committed.mime,
        sizeBytes: committed.sizeBytes,
        sha256: committed.sha256,
        convertedPdfKey: committed.storageKey,
        previewKeys: analysis.previewFilenames,
        pageCount: analysis.pageCount,
        classification: analysis.perPageClassification
      });

      const settings = context.settings ?? emptySettings();
      const breakdown = calculatePricing({
        totalPages: analysis.pageCount,
        perPageClassification: analysis.perPageClassification,
        settings
      });

      const item = await db.addOrderItem({
        orderId: order.id,
        fileId: fileRecord.id,
        settings,
        pageCount: analysis.pageCount,
        colourPages: breakdown.colorPagesCount,
        bwPages: breakdown.bwPagesCount,
        sheets: breakdown.sheets,
        lineTotalPaise: breakdown.subtotalPaise,
        printerId: null
      });

      context.fileId = fileRecord.id;
      context.itemId = item.id;
      context.originalName = committed.originalName;
      context.pageCount = analysis.pageCount;
      context.perPageClassification = analysis.perPageClassification;
      context.settings = settings;
      context.step = 'color';
      session.state = 'CONFIGURING';
      this.touch(session);
      await db.saveWaSession(session);

      await provider.sendText(
        waId,
        copy.fileAnalyzed(committed.originalName, analysis.pageCount, breakdown.colorPagesCount)
      );
      await provider.sendButtons(waId, copy.chooseColor, [
        { id: 'color_bw', title: 'All B&W' },
        { id: 'color_smart', title: 'Smart' },
        { id: 'color_color', title: 'All Colour' }
      ]);
    } catch (err) {
      await storage.deleteFile(fileRecord.id).catch(() => {});
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // CONFIGURING
  // --------------------------------------------------------------------------

  private async handleConfiguring(
    session: WhatsAppSessionRecord,
    selection: string,
    waId: string,
    copy: (typeof COPY)[WaLanguage]
  ): Promise<void> {
    const provider = getWhatsAppProvider();
    const context = session.context as SessionContext;

    if (selection === 'add_file') {
      const order = session.orderId ? await db.getOrderById(session.orderId) : undefined;
      if (!order) return;
      const items = await db.getOrderItemsByOrderId(order.id);
      if (items.length >= 5) {
        await provider.sendText(waId, copy.fileLimit);
        return;
      }
      session.state = 'AWAITING_FILE';
      context.step = 'file';
      await db.saveWaSession(session);
      await provider.sendText(waId, copy.askFile);
      return;
    }

    if (selection === 'change_options') {
      context.step = 'color';
      session.state = 'CONFIGURING';
      await db.saveWaSession(session);
      await provider.sendButtons(waId, copy.chooseColor, [
        { id: 'color_bw', title: 'All B&W' },
        { id: 'color_smart', title: 'Smart' },
        { id: 'color_color', title: 'All Colour' }
      ]);
      return;
    }

    if (!context.settings) context.settings = emptySettings();

    if (context.step === 'color') {
      const settings = context.settings;
      if (selection.includes('smart')) settings.colorMode = 'smart';
      else if (
        selection.includes('color_color') ||
        selection.includes('full') ||
        selection.includes('colour') ||
        selection === 'color' ||
        selection === 'color full'
      ) {
        settings.colorMode = 'color';
      } else {
        settings.colorMode = 'bw';
      }
      context.step = 'sides';
      await db.saveWaSession(session);
      await provider.sendButtons(waId, copy.chooseSides, [
        { id: 'sides_single', title: 'Single-sided' },
        { id: 'sides_duplex', title: 'Back-to-Back' }
      ]);
      return;
    }

    if (context.step === 'sides') {
      context.settings.sides =
        selection.includes('duplex') || selection.includes('back') || selection.includes('double')
          ? 'duplex'
          : 'single';
      context.step = 'copies';
      await db.saveWaSession(session);
      await provider.sendList(waId, copy.chooseCopies, 'Copies', [
        { id: 'copies_1', title: '1 Copy' },
        { id: 'copies_2', title: '2 Copies' },
        { id: 'copies_5', title: '5 Copies' },
        { id: 'copies_other', title: 'Other', description: 'Type a number from 1 to 100' }
      ]);
      return;
    }

    if (context.step === 'copies' && selection === 'copies_other') {
      context.step = 'copies_other';
      await db.saveWaSession(session);
      await provider.sendText(waId, copy.askCopiesOther);
      return;
    }

    if (context.step === 'copies' || context.step === 'copies_other') {
      const digits = selection.replace(/[^0-9]/g, '');
      const parsed = parseInt(digits, 10);
      if (context.step === 'copies_other' && !Number.isFinite(parsed)) {
        await provider.sendText(waId, copy.askCopiesOther);
        return;
      }
      const copies = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 1;
      context.settings.copies = copies;
      context.step = 'review';
      await this.sendReview(session, waId, copy);
      return;
    }

    // Unknown step: restart configuration rather than corrupting state.
    context.step = 'color';
    await db.saveWaSession(session);
    await provider.sendButtons(waId, copy.chooseColor, [
      { id: 'color_bw', title: 'All B&W' },
      { id: 'color_smart', title: 'Smart' },
      { id: 'color_color', title: 'All Colour' }
    ]);
  }

  // --------------------------------------------------------------------------
  // REVIEW / PAYMENT
  // --------------------------------------------------------------------------

  private async priceOrder(
    orderId: string,
    settingsOverride?: PrintSettings
  ): Promise<{
    totalPaise: number;
    summaryLines: NonNullable<SessionContext['itemsSummary']>;
  }> {
    const order = await db.getOrderById(orderId);
    if (!order) throw new Error('Order not found');
    const shop = await db.getShopById(order.shopId);
    const rates = await db.getRateCardsByShopId(order.shopId);
    const items = await db.getOrderItemsByOrderId(orderId);

    const pricingItems = [];
    const summaryLines: NonNullable<SessionContext['itemsSummary']> = [];
    for (const item of items) {
      const file = await db.getFileById(item.fileId);
      const itemSettings = settingsOverride ? { ...settingsOverride } : item.settings;
      pricingItems.push({
        totalPages: item.pageCount,
        perPageClassification: file?.classification ?? [],
        settings: itemSettings
      });
      summaryLines.push({
        name: file?.originalName ?? 'document',
        pages: item.pageCount,
        copies: itemSettings.copies,
        mode: itemSettings.colorMode,
        sides: itemSettings.sides,
        linePaise: 0
      });
    }

    const pricing = calculateOrderPricing(pricingItems, {
      minOrderPaise: shop?.settings.minOrderPaise ?? 500,
      platformConvenienceFeePaise: shop?.settings.platformConvenienceFeePaise ?? 100,
      gstRatePercent: shop?.settings.gstRatePercent ?? 0,
      rates: rates.length > 0 ? rates : DEFAULT_STANDARD_INDIAN_RATES
    });

    for (let index = 0; index < items.length; index++) {
      const item = items[index]!;
      const breakdown = pricing.items[index]!;
      await db.updateOrderItem(item.id, {
        settings: settingsOverride ? { ...settingsOverride } : item.settings,
        colourPages: breakdown.colorPagesCount,
        bwPages: breakdown.bwPagesCount,
        sheets: breakdown.sheets,
        lineTotalPaise: breakdown.subtotalPaise
      });
      summaryLines[index]!.linePaise = breakdown.subtotalPaise;
    }

    await db.updateOrderTotals(orderId, {
      subtotalPaise: pricing.subtotalPaise,
      feePaise: pricing.feePaise,
      gstPaise: pricing.gstPaise,
      totalPaise: pricing.totalPaise
    });

    return { totalPaise: pricing.totalPaise, summaryLines };
  }

  private formatSummary(
    shopName: string,
    lines: NonNullable<SessionContext['itemsSummary']>,
    order: OrderRecord,
    copy: (typeof COPY)[WaLanguage]
  ): string {
    const items = lines
      .map(
        (line) =>
          `• ${line.name}: ${line.pages} pages × ${line.copies} (${line.mode.toUpperCase()}, ${line.sides}) — ₹${money(
            line.linePaise
          )}`
      )
      .join('\n');
    const fee = `Convenience fee ₹${money(order.feePaise)}`;
    const gst = order.gstPaise > 0 ? `\nGST ₹${money(order.gstPaise)}` : '';
    return `${items}\n${fee}${gst}`;
  }

  private async sendReview(
    session: WhatsAppSessionRecord,
    waId: string,
    copy: (typeof COPY)[WaLanguage]
  ): Promise<void> {
    const provider = getWhatsAppProvider();
    if (!session.orderId) return;
    const order = await db.getOrderById(session.orderId);
    if (!order) return;
    const shop = await db.getShopById(order.shopId);

    const priced = await this.priceOrder(order.id, (session.context as SessionContext).settings);
    const refreshed = (await db.getOrderById(order.id))!;
    const context = session.context as SessionContext;
    context.itemsSummary = priced.summaryLines;
    context.totalPaise = priced.totalPaise;
    context.step = 'review';
    session.state = 'REVIEW';
    this.touch(session);
    await db.saveWaSession(session);

    const summary = this.formatSummary(shop?.name ?? 'Shop', priced.summaryLines, refreshed, copy);
    await provider.sendText(
      waId,
      copy.orderReview(shop?.name ?? 'Shop', summary, money(priced.totalPaise))
    );
    await provider.sendButtons(waId, 'Confirm this order?', [
      { id: 'pay_now', title: copy.payNow },
      { id: 'change_options', title: copy.changeOptions },
      { id: 'cancel_order', title: copy.cancelOrder }
    ]);
  }

  private async handleReviewReply(
    session: WhatsAppSessionRecord,
    selection: string,
    waId: string,
    copy: (typeof COPY)[WaLanguage]
  ): Promise<void> {
    const provider = getWhatsAppProvider();
    if (selection === 'cancel_order' || selection === 'cancel') {
      await this.cancelSession(waId, session, {
        from: waId,
        messageId: '',
        type: 'text'
      });
      return;
    }
    if (selection === 'change_options') {
      const context = session.context as SessionContext;
      context.step = 'color';
      session.state = 'CONFIGURING';
      await db.saveWaSession(session);
      await provider.sendButtons(waId, copy.chooseColor, [
        { id: 'color_bw', title: 'All B&W' },
        { id: 'color_smart', title: 'Smart' },
        { id: 'color_color', title: 'All Colour' }
      ]);
      return;
    }
    if (selection === 'add_file') {
      const context = session.context as SessionContext;
      context.step = 'file';
      session.state = 'AWAITING_FILE';
      await db.saveWaSession(session);
      await provider.sendText(waId, copy.askFile);
      return;
    }
    if (selection === 'pay_now' || selection === 'pay' || selection === 'paid') {
      await this.sendPaymentLink(session, waId, copy);
      return;
    }
    // Unknown reply: show the review again (idempotent, no order change).
    await this.sendReview(session, waId, copy);
  }

  private async sendPaymentLink(
    session: WhatsAppSessionRecord,
    waId: string,
    copy: (typeof COPY)[WaLanguage]
  ): Promise<void> {
    const provider = getWhatsAppProvider();
    if (!session.orderId) return;
    const order = await db.getOrderById(session.orderId);
    if (!order) return;
    if (!['draft', 'awaiting_payment'].includes(order.status)) {
      await this.sendStatus(waId, session);
      return;
    }

    // Recompute immediately before creating the link: the amount sent to
    // Razorpay must be the server's final quote.
    const priced = await this.priceOrder(order.id, (session.context as SessionContext).settings);
    const refreshed = (await db.getOrderById(order.id))!;
    const link = await paymentService.createPaymentLink(order.id);
    if (link.amountPaise !== priced.totalPaise || refreshed.totalPaise !== priced.totalPaise) {
      throw new Error('Payment link amount diverged from the order total');
    }

    const context = session.context as SessionContext;
    context.step = 'review';
    context.totalPaise = link.amountPaise;
    session.state = 'AWAITING_PAYMENT';
    this.touch(session);
    await db.saveWaSession(session);

    const shop = await db.getShopById(order.shopId);
    const summary = this.formatSummary(shop?.name ?? 'Shop', context.itemsSummary ?? [], refreshed, copy);
    await provider.sendText(
      waId,
      `${copy.orderReview(shop?.name ?? 'Shop', summary, money(link.amountPaise))}\n\n${copy.paymentLinkMessage(
        link.shortUrl,
        money(link.amountPaise)
      )}`
    );
  }

  /** Called by the payment webhook after a verified payment. */
  async onOrderPaid(order: OrderRecord): Promise<void> {
    const session = await db.getWaSessionByOrderId(order.id);
    if (!session) return;
    session.state = 'TRACKING';
    this.touch(session);
    await db.saveWaSession(session);
  }

  /**
   * Expires sessions and their unpaid draft/awaiting orders. Called by the
   * reconciliation loop; safe to run repeatedly.
   */
  async expireSessions(now = new Date()): Promise<number> {
    const expired = await db.expireInactiveWaSessions(now);
    let count = 0;
    for (const session of expired) {
      if (!session.orderId) continue;
      const order = await db.getOrderById(session.orderId);
      if (!order) continue;
      if (order.status === 'draft' || order.status === 'awaiting_payment') {
        const result = await db.transitionOrderStatus(order.id, 'expired', {
          reason: 'whatsapp_session_expired'
        });
        if (result.success) count++;
      }
    }
    return count;
  }
}

export const conversationManager = new ConversationManager();
