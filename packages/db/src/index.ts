import crypto from 'node:crypto';
import pg from 'pg';
import type {
  DatabaseRepository,
  ShopRecord,
  UserRecord,
  AgentRecord,
  PrinterRecord,
  RateCardRecord,
  OrderRecord,
  FileRecord,
  OrderItemRecord,
  PaymentRecord,
  PrintJobRecord,
  WebhookEventRecord,
  WhatsAppSessionRecord,
  WhatsAppMessageRecord,
  OtpCodeRecord,
  RefreshTokenRecord,
  CreateShopInput,
  CreateUserInput
} from './types.js';
import {
  canTransitionOrder,
  generatePickupToken,
  generatePublicToken,
  normalizePhone,
  sha256Hex,
  type OrderStatus,
  type OrderChannel,
  type PrinterStatus,
  type PageClassification
} from '@chhaap/shared';

export * from './types.js';

// ============================================================================
// SHARED MAPPING HELPERS
// ============================================================================

function nowIso(): string {
  return new Date().toISOString();
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

// ============================================================================
// IN-MEMORY REPOSITORY (tests + zero-config development)
// ============================================================================

export class MemoryDatabase implements DatabaseRepository {
  users = new Map<string, UserRecord>();
  shops = new Map<string, ShopRecord>();
  agents = new Map<string, AgentRecord>();
  printers = new Map<string, PrinterRecord>();
  rateCards = new Map<string, RateCardRecord>();
  orders = new Map<string, OrderRecord>();
  files = new Map<string, FileRecord>();
  orderItems = new Map<string, OrderItemRecord>();
  payments = new Map<string, PaymentRecord>();
  printJobs = new Map<string, PrintJobRecord>();
  events: Array<{ id: string; orderId: string | null; shopId: string | null; type: string; payload: Record<string, unknown>; createdAt: string }> = [];
  webhookEvents = new Map<string, WebhookEventRecord>();
  waSessions = new Map<string, WhatsAppSessionRecord>(); // key: waId
  waMessages = new Map<string, WhatsAppMessageRecord>(); // key: wamid
  waStatusEvents = new Set<string>(); // `${wamid}:${status}`
  waOptouts = new Set<string>();
  otpCodes: OtpCodeRecord[] = [];
  refreshTokens = new Map<string, RefreshTokenRecord>(); // key: tokenHash
  notifications = new Set<string>(); // `${orderId}:${event}`

  constructor() {
    this.seedDefaultData();
  }

  async ping(): Promise<boolean> {
    return true;
  }

  seedDefaultData() {
    const ownerId = 'user-owner-1';
    this.users.set(ownerId, {
      id: ownerId,
      email: 'owner@campusxerox.in',
      phone: '9876543210',
      name: 'Ramesh Sharma',
      role: 'owner',
      passwordHash: null,
      createdAt: nowIso()
    });

    const shopId = 'shop-campus-xerox';
    this.shops.set(shopId, {
      id: shopId,
      slug: 'campus-xerox',
      name: 'Campus Xerox & Stationary',
      ownerId,
      city: 'Lucknow',
      phone: '9876543210',
      gstNo: null,
      status: 'active',
      planId: 'starter',
      settings: {
        minOrderPaise: 500,
        platformConvenienceFeePaise: 100,
        gstRatePercent: 0,
        isOpen: true,
        upiVpa: 'campusxerox@upi',
        whatsappNumber: '919876543210',
        ownerAlertsEnabled: true,
        printerOfflineAlertEnabled: true,
        orderFailedAlertEnabled: true,
        dailySummaryEnabled: false
      },
      createdAt: nowIso()
    });

    const agentId = 'agent-campus-1';
    const rawToken = 'test_agent_secret_token_123';
    this.agents.set(agentId, {
      id: agentId,
      shopId,
      name: 'Shop PC Front Desk',
      tokenHash: sha256Hex(rawToken), // legacy no-pepper seed token for dev
      pairingCode: sha256Hex('123456'),
      pairingCodeExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      pairingAttempts: 0,
      version: '0.1.0',
      lastSeenAt: nowIso(),
      os: 'linux',
      status: 'offline',
      createdAt: nowIso()
    });

    const printerId = 'printer-cups-pdf';
    this.printers.set(printerId, {
      id: printerId,
      shopId,
      agentId,
      systemName: 'PDF',
      displayName: 'Virtual CUPS-PDF (A4/A3 Mono & Colour)',
      capabilities: {
        systemName: 'PDF',
        displayName: 'Virtual CUPS-PDF (A4/A3 Mono & Colour)',
        color: true,
        duplex: true,
        papers: ['A4', 'A3', 'Legal'],
        dpi: 600
      },
      status: 'online',
      lastStatusAt: nowIso(),
      createdAt: nowIso()
    });

    const rates: Array<Omit<RateCardRecord, 'id' | 'shopId' | 'printerId' | 'minOrderPaise'>> = [
      { paperSize: 'A4', colorMode: 'bw', sides: 'single', pricePerPagePaise: 200 },
      { paperSize: 'A4', colorMode: 'bw', sides: 'duplex', pricePerPagePaise: 150 },
      { paperSize: 'A4', colorMode: 'color', sides: 'single', pricePerPagePaise: 1000 },
      { paperSize: 'A4', colorMode: 'color', sides: 'duplex', pricePerPagePaise: 800 },
      { paperSize: 'A3', colorMode: 'bw', sides: 'single', pricePerPagePaise: 1000 },
      { paperSize: 'A3', colorMode: 'bw', sides: 'duplex', pricePerPagePaise: 800 },
      { paperSize: 'A3', colorMode: 'color', sides: 'single', pricePerPagePaise: 3000 },
      { paperSize: 'A3', colorMode: 'color', sides: 'duplex', pricePerPagePaise: 2500 },
      { paperSize: 'Legal', colorMode: 'bw', sides: 'single', pricePerPagePaise: 300 },
      { paperSize: 'Legal', colorMode: 'bw', sides: 'duplex', pricePerPagePaise: 200 },
      { paperSize: 'Legal', colorMode: 'color', sides: 'single', pricePerPagePaise: 1200 },
      { paperSize: 'Legal', colorMode: 'color', sides: 'duplex', pricePerPagePaise: 1000 }
    ];

    for (const r of rates) {
      const id = `rate-${r.paperSize}-${r.colorMode}-${r.sides}`;
      this.rateCards.set(id, {
        id,
        shopId,
        printerId: null,
        minOrderPaise: 500,
        ...r
      });
    }
  }

  // --- Shops & Users ---
  async getShopBySlug(slug: string): Promise<ShopRecord | undefined> {
    return Array.from(this.shops.values()).find((s) => s.slug === slug);
  }

  async getShopById(id: string): Promise<ShopRecord | undefined> {
    return this.shops.get(id);
  }

  async getShopByOwnerId(ownerId: string): Promise<ShopRecord | undefined> {
    return Array.from(this.shops.values()).find((s) => s.ownerId === ownerId);
  }

  async getAllShops(): Promise<ShopRecord[]> {
    return Array.from(this.shops.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createShop(input: CreateShopInput): Promise<ShopRecord> {
    const shop: ShopRecord = {
      id: crypto.randomUUID(),
      slug: input.slug,
      name: input.name,
      ownerId: input.ownerId,
      city: input.city ?? 'Lucknow',
      phone: input.phone ?? null,
      gstNo: input.gstNo ?? null,
      status: input.status ?? 'active',
      planId: input.planId ?? 'starter',
      settings: { ...input.settings },
      createdAt: nowIso()
    };
    this.shops.set(shop.id, shop);
    return shop;
  }

  async updateShop(id: string, updates: Partial<ShopRecord>): Promise<ShopRecord | undefined> {
    const shop = this.shops.get(id);
    if (!shop) return undefined;
    const updated: ShopRecord = {
      ...shop,
      ...updates,
      settings: { ...shop.settings, ...(updates.settings ?? {}) }
    };
    this.shops.set(id, updated);
    return updated;
  }

  async getUserByPhone(phone: string): Promise<UserRecord | undefined> {
    const normalized = normalizePhone(phone);
    return Array.from(this.users.values()).find(
      (u) => u.phone != null && normalizePhone(u.phone) === normalized
    );
  }

  async getUserById(id: string): Promise<UserRecord | undefined> {
    return this.users.get(id);
  }

  async createUser(input: CreateUserInput): Promise<UserRecord> {
    const user: UserRecord = {
      id: crypto.randomUUID(),
      email: input.email ?? null,
      phone: input.phone ? normalizePhone(input.phone) : null,
      name: input.name,
      role: input.role ?? 'owner',
      passwordHash: input.passwordHash ?? null,
      createdAt: nowIso()
    };
    this.users.set(user.id, user);
    return user;
  }

  // --- Agents & Printers ---
  async getPrintersByShopId(shopId: string): Promise<PrinterRecord[]> {
    return Array.from(this.printers.values()).filter((p) => p.shopId === shopId);
  }

  async getAgentsByShopId(shopId: string): Promise<AgentRecord[]> {
    return Array.from(this.agents.values()).filter((a) => a.shopId === shopId);
  }

  async getAgentById(id: string): Promise<AgentRecord | undefined> {
    return this.agents.get(id);
  }

  async getAgentByToken(rawToken: string, pepper = ''): Promise<AgentRecord | undefined> {
    const hashed = sha256Hex(rawToken + pepper);
    const legacy = sha256Hex(rawToken);
    return Array.from(this.agents.values()).find(
      (a) => a.tokenHash === hashed || a.tokenHash === legacy
    );
  }

  async getAgentByPairingCode(code: string, pepper = ''): Promise<AgentRecord | undefined> {
    const codeHash = sha256Hex(code + pepper);
    const now = nowIso();
    return Array.from(this.agents.values()).find(
      (a) =>
        a.pairingCode === codeHash &&
        (!a.pairingCodeExpiresAt || a.pairingCodeExpiresAt > now) &&
        (a.pairingAttempts ?? 0) < 5
    );
  }

  async createAgent(input: {
    shopId: string;
    name: string;
    tokenHash: string;
    pairingCode: string | null;
    pairingCodeExpiresAt: string | null;
    os?: string | null;
  }): Promise<AgentRecord> {
    const agent: AgentRecord = {
      id: crypto.randomUUID(),
      shopId: input.shopId,
      name: input.name,
      tokenHash: input.tokenHash,
      pairingCode: input.pairingCode,
      pairingCodeExpiresAt: input.pairingCodeExpiresAt,
      pairingAttempts: 0,
      version: '0.1.0',
      lastSeenAt: null,
      os: input.os ?? null,
      status: 'offline',
      createdAt: nowIso()
    };
    this.agents.set(agent.id, agent);
    return agent;
  }

  async updateAgent(agentId: string, updates: Partial<AgentRecord>): Promise<AgentRecord | undefined> {
    const agent = this.agents.get(agentId);
    if (!agent) return undefined;
    const updated = { ...agent, ...updates };
    this.agents.set(agentId, updated);
    return updated;
  }

  async incrementPairingAttempt(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (agent) agent.pairingAttempts = (agent.pairingAttempts ?? 0) + 1;
  }

  async updatePrinterStatus(printerId: string, status: PrinterStatus): Promise<PrinterRecord | undefined> {
    const printer = this.printers.get(printerId);
    if (!printer) return undefined;
    printer.status = status;
    printer.lastStatusAt = nowIso();
    return printer;
  }

  async upsertPrintersForAgent(
    agentId: string,
    shopId: string,
    printers: PrinterRecord['capabilities'][]
  ): Promise<void> {
    for (const cap of printers) {
      const existing = Array.from(this.printers.values()).find(
        (p) => p.agentId === agentId && p.systemName === cap.systemName
      );
      if (existing) {
        existing.capabilities = cap;
        existing.displayName = cap.displayName;
        existing.status = 'online';
        existing.lastStatusAt = nowIso();
      } else {
        const id = `printer-${crypto.randomUUID()}`;
        this.printers.set(id, {
          id,
          shopId,
          agentId,
          systemName: cap.systemName,
          displayName: cap.displayName,
          capabilities: cap,
          status: 'online',
          lastStatusAt: nowIso(),
          createdAt: nowIso()
        });
      }
    }
  }

  // --- Rate Cards ---
  async getRateCardsByShopId(shopId: string): Promise<RateCardRecord[]> {
    return Array.from(this.rateCards.values()).filter((r) => r.shopId === shopId);
  }

  async saveRateCards(shopId: string, rates: RateCardRecord[]): Promise<void> {
    for (const [id, r] of this.rateCards.entries()) {
      if (r.shopId === shopId) this.rateCards.delete(id);
    }
    for (const r of rates) {
      const id = r.id || `rate-${shopId}-${r.paperSize}-${r.colorMode}-${r.sides}`;
      this.rateCards.set(id, {
        ...r,
        id,
        shopId,
        printerId: r.printerId ?? null,
        minOrderPaise: r.minOrderPaise ?? 500
      });
    }
  }

  // --- Orders ---
  async createOrder(data: {
    shopId: string;
    customerPhone?: string | null;
    customerEmail?: string | null;
    customerWaId?: string | null;
    channel?: OrderChannel;
    idempotencyKey: string;
  }): Promise<OrderRecord> {
    for (const ord of this.orders.values()) {
      if (ord.idempotencyKey === data.idempotencyKey) return ord;
    }

    const order: OrderRecord = {
      id: crypto.randomUUID(),
      shopId: data.shopId,
      token: generatePickupToken(),
      publicToken: generatePublicToken(),
      channel: data.channel ?? 'web',
      customerPhone: data.customerPhone ?? null,
      customerEmail: data.customerEmail ?? null,
      customerWaId: data.customerWaId ?? null,
      status: 'draft',
      subtotalPaise: 0,
      feePaise: 100,
      gstPaise: 0,
      totalPaise: 0,
      currency: 'INR',
      idempotencyKey: data.idempotencyKey,
      createdAt: nowIso(),
      paidAt: null,
      completedAt: null,
      expiresAt: new Date(Date.now() + 3600000).toISOString()
    };

    this.orders.set(order.id, order);
    await this.logEvent(order.id, data.shopId, 'order.created', {
      orderId: order.id,
      token: order.token,
      channel: order.channel
    });
    return order;
  }

  async getOrderById(id: string): Promise<OrderRecord | undefined> {
    return this.orders.get(id);
  }

  async getOrderByPublicToken(publicToken: string): Promise<OrderRecord | undefined> {
    return Array.from(this.orders.values()).find((o) => o.publicToken === publicToken);
  }

  async getOrdersByShopId(shopId: string): Promise<OrderRecord[]> {
    return Array.from(this.orders.values())
      .filter((o) => o.shopId === shopId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getLastOrderByWaId(waId: string): Promise<OrderRecord | undefined> {
    return Array.from(this.orders.values())
      .filter((o) => o.customerWaId === waId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  async updateOrderTotals(
    orderId: string,
    totals: { subtotalPaise: number; feePaise: number; gstPaise: number; totalPaise: number }
  ): Promise<OrderRecord | undefined> {
    const order = this.orders.get(orderId);
    if (!order) return undefined;
    Object.assign(order, totals);
    return order;
  }

  async transitionOrderStatus(
    orderId: string,
    to: OrderStatus,
    metadata?: Record<string, unknown>
  ): Promise<{ success: boolean; order?: OrderRecord; error?: string }> {
    const order = this.orders.get(orderId);
    if (!order) return { success: false, error: 'Order not found' };

    if (!canTransitionOrder(order.status, to)) {
      return {
        success: false,
        error: `Cannot transition order from '${order.status}' to '${to}'`
      };
    }

    const previous = order.status;
    order.status = to;
    if (to === 'paid') order.paidAt = nowIso();
    if (to === 'completed') order.completedAt = nowIso();

    await this.logEvent(orderId, order.shopId, `order.status.${to}`, {
      orderId,
      previousStatus: previous,
      newStatus: to,
      ...(metadata ?? {})
    });

    return { success: true, order };
  }

  async getOrdersAwaitingPaymentExpired(olderThanDate: Date): Promise<OrderRecord[]> {
    const threshold = olderThanDate.getTime();
    return Array.from(this.orders.values()).filter(
      (o) => o.status === 'awaiting_payment' && new Date(o.createdAt).getTime() < threshold
    );
  }

  // --- Files & Order Items ---
  async addFile(file: Omit<FileRecord, 'id' | 'createdAt'>): Promise<FileRecord> {
    const record: FileRecord = {
      id: crypto.randomUUID(),
      ...file,
      createdAt: nowIso()
    };
    this.files.set(record.id, record);
    return record;
  }

  async getFileById(id: string): Promise<FileRecord | undefined> {
    return this.files.get(id);
  }

  async updateFile(id: string, updates: Partial<FileRecord>): Promise<FileRecord | undefined> {
    const file = this.files.get(id);
    if (!file) return undefined;
    const updated = { ...file, ...updates };
    this.files.set(id, updated);
    return updated;
  }

  async getFilesPendingDeletion(now: Date): Promise<FileRecord[]> {
    const nowIsoStr = now.toISOString();
    return Array.from(this.files.values()).filter(
      (f) => !f.deletedAt && f.deleteAfter <= nowIsoStr
    );
  }

  async markFileDeleted(fileId: string): Promise<boolean> {
    const file = this.files.get(fileId);
    if (!file || file.deletedAt) return false;
    file.deletedAt = nowIso();
    return true;
  }

  async addOrderItem(item: Omit<OrderItemRecord, 'id'>): Promise<OrderItemRecord> {
    const record: OrderItemRecord = { id: crypto.randomUUID(), ...item };
    this.orderItems.set(record.id, record);
    return record;
  }

  async getOrderItemById(id: string): Promise<OrderItemRecord | undefined> {
    return this.orderItems.get(id);
  }

  async getOrderItemsByOrderId(orderId: string): Promise<OrderItemRecord[]> {
    return Array.from(this.orderItems.values()).filter((i) => i.orderId === orderId);
  }

  async updateOrderItem(
    id: string,
    updates: Partial<OrderItemRecord>
  ): Promise<OrderItemRecord | undefined> {
    const item = this.orderItems.get(id);
    if (!item) return undefined;
    const updated = { ...item, ...updates };
    this.orderItems.set(id, updated);
    return updated;
  }

  // --- Payments ---
  async createPayment(payment: Omit<PaymentRecord, 'id' | 'createdAt'>): Promise<PaymentRecord> {
    const existing = Array.from(this.payments.values()).find(
      (p) => p.orderId === payment.orderId && p.status === 'created'
    );
    if (existing) {
      existing.razorpayOrderId = payment.razorpayOrderId;
      existing.paymentLinkId = payment.paymentLinkId;
      existing.amountPaise = payment.amountPaise;
      existing.method = payment.method;
      return existing;
    }
    const record: PaymentRecord = { id: crypto.randomUUID(), ...payment, createdAt: nowIso() };
    this.payments.set(record.id, record);
    return record;
  }

  async updatePayment(
    id: string,
    updates: Partial<PaymentRecord>
  ): Promise<PaymentRecord | undefined> {
    const payment = this.payments.get(id);
    if (!payment) return undefined;
    const updated = { ...payment, ...updates };
    this.payments.set(id, updated);
    return updated;
  }

  async getPaymentByOrderId(orderId: string): Promise<PaymentRecord | undefined> {
    return Array.from(this.payments.values()).find((p) => p.orderId === orderId);
  }

  async getPaymentByRazorpayOrderId(rzpOrderId: string): Promise<PaymentRecord | undefined> {
    return Array.from(this.payments.values()).find((p) => p.razorpayOrderId === rzpOrderId);
  }

  async getPaymentByPaymentLinkId(linkId: string): Promise<PaymentRecord | undefined> {
    return Array.from(this.payments.values()).find((p) => p.paymentLinkId === linkId);
  }

  // --- Webhook Events Deduplication ---
  async recordWebhookEvent(
    provider: string,
    eventId: string,
    payload: Record<string, unknown>
  ): Promise<boolean> {
    const key = `${provider}:${eventId}`;
    if (this.webhookEvents.has(key)) return false;
    this.webhookEvents.set(key, {
      id: crypto.randomUUID(),
      provider,
      eventId,
      payload,
      processedAt: nowIso()
    });
    return true;
  }

  // --- Print Jobs ---
  async createPrintJob(
    data: Omit<
      PrintJobRecord,
      'id' | 'createdAt' | 'attempts' | 'lastError' | 'dispatchedAt' | 'finishedAt'
    >
  ): Promise<PrintJobRecord> {
    const record: PrintJobRecord = {
      id: crypto.randomUUID(),
      ...data,
      attempts: 0,
      lastError: null,
      dispatchedAt: null,
      finishedAt: null,
      createdAt: nowIso()
    };
    this.printJobs.set(record.id, record);
    return record;
  }

  async getPrintJobById(id: string): Promise<PrintJobRecord | undefined> {
    return this.printJobs.get(id);
  }

  async getPrintJobsByOrderItemId(orderItemId: string): Promise<PrintJobRecord[]> {
    return Array.from(this.printJobs.values()).filter((j) => j.orderItemId === orderItemId);
  }

  async getPendingPrintJobsForShop(
    shopId: string
  ): Promise<Array<{ job: PrintJobRecord; item: OrderItemRecord; file: FileRecord; order: OrderRecord }>> {
    const results: Array<{
      job: PrintJobRecord;
      item: OrderItemRecord;
      file: FileRecord;
      order: OrderRecord;
    }> = [];
    for (const job of this.printJobs.values()) {
      if (job.status !== 'pending' && job.status !== 'dispatched') continue;
      const item = this.orderItems.get(job.orderItemId);
      if (!item) continue;
      const order = this.orders.get(item.orderId);
      if (!order || order.shopId !== shopId) continue;
      const file = this.files.get(item.fileId);
      if (!file) continue;
      results.push({ job, item, file, order });
    }
    return results;
  }

  async updatePrintJob(
    id: string,
    updates: Partial<PrintJobRecord>
  ): Promise<PrintJobRecord | undefined> {
    const job = this.printJobs.get(id);
    if (!job) return undefined;
    const updated = { ...job, ...updates };
    this.printJobs.set(id, updated);
    return updated;
  }

  // --- WhatsApp Sessions & Messages ---
  async getActiveWaSession(waId: string): Promise<WhatsAppSessionRecord | undefined> {
    const session = this.waSessions.get(waId);
    if (!session) return undefined;
    if (session.state === 'DONE' || session.expiresAt <= nowIso()) return undefined;
    return session;
  }

  async getWaSessionByOrderId(orderId: string): Promise<WhatsAppSessionRecord | undefined> {
    return Array.from(this.waSessions.values()).find(
      (s) => s.orderId === orderId && s.state !== 'DONE'
    );
  }

  async saveWaSession(session: WhatsAppSessionRecord): Promise<void> {
    // A WhatsApp conversation has at most one current session. Starting a new
    // one closes the previous active session instead of letting it resurface.
    const existing = this.waSessions.get(session.waId);
    if (existing && existing.id !== session.id && existing.state !== 'DONE') {
      this.waSessions.set(session.waId, { ...existing, state: 'DONE' });
    }
    this.waSessions.set(session.waId, session);
  }

  async expireInactiveWaSessions(now: Date): Promise<WhatsAppSessionRecord[]> {
    const nowStr = now.toISOString();
    const expired: WhatsAppSessionRecord[] = [];
    for (const session of this.waSessions.values()) {
      if (session.state !== 'DONE' && session.expiresAt <= nowStr) {
        session.state = 'DONE';
        expired.push(session);
      }
    }
    return expired;
  }

  async recordWaMessage(
    message: Omit<WhatsAppMessageRecord, 'id' | 'createdAt'>
  ): Promise<WhatsAppMessageRecord> {
    const existing = this.waMessages.get(message.wamid);
    if (existing) return existing;
    const record: WhatsAppMessageRecord = { id: crypto.randomUUID(), ...message, createdAt: nowIso() };
    this.waMessages.set(record.wamid, record);
    return record;
  }

  async isWaMessageProcessed(wamid: string): Promise<boolean> {
    return this.waMessages.has(wamid);
  }

  async updateWaMessageStatus(wamid: string, status: string): Promise<void> {
    const message = this.waMessages.get(wamid);
    if (message) message.status = status;
  }

  async recordWaStatus(wamid: string, status: string): Promise<boolean> {
    const key = `${wamid}:${status}`;
    if (this.waStatusEvents.has(key)) return false;
    this.waStatusEvents.add(key);
    return true;
  }

  async purgeOldWaMessages(before: Date): Promise<number> {
    const threshold = before.toISOString();
    let count = 0;
    for (const [wamid, message] of this.waMessages.entries()) {
      if (message.createdAt < threshold) {
        this.waMessages.delete(wamid);
        count++;
      }
    }
    return count;
  }

  async isOptedOut(waId: string): Promise<boolean> {
    return this.waOptouts.has(waId);
  }

  async setOptOut(waId: string): Promise<void> {
    this.waOptouts.add(waId);
  }

  async clearOptOut(waId: string): Promise<void> {
    this.waOptouts.delete(waId);
  }

  // --- OTP & refresh tokens ---
  async createOtp(phone: string, code: string, pepper = ''): Promise<{ id: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const record: OtpCodeRecord = {
      id: crypto.randomUUID(),
      phone: normalizePhone(phone),
      codeHash: sha256Hex(code + pepper),
      attempts: 0,
      expiresAt: expiresAt.toISOString(),
      consumedAt: null
    };
    this.otpCodes.push(record);
    return { id: record.id, expiresAt };
  }

  async verifyOtp(phone: string, code: string, pepper = ''): Promise<{ valid: boolean; error?: string }> {
    const normalized = normalizePhone(phone);
    const nowStr = nowIso();
    const codeHash = sha256Hex(code + pepper);
    const match = this.otpCodes
      .filter((o) => o.phone === normalized && !o.consumedAt && o.expiresAt > nowStr)
      .sort((a, b) => b.expiresAt.localeCompare(a.expiresAt))[0];

    if (!match) return { valid: false, error: 'No active OTP found. Please request a new one.' };
    if (match.attempts >= 5) {
      return { valid: false, error: 'Too many invalid attempts. Please request a new OTP.' };
    }
    if (match.codeHash !== codeHash) {
      match.attempts++;
      return { valid: false, error: 'Invalid verification code.' };
    }
    match.consumedAt = nowStr;
    return { valid: true };
  }

  async createRefreshToken(
    userId: string,
    token: string,
    pepper = '',
    ttlSeconds = 30 * 86400
  ): Promise<{ id: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const record: RefreshTokenRecord = {
      id: crypto.randomUUID(),
      userId,
      tokenHash: sha256Hex(token + pepper),
      expiresAt: expiresAt.toISOString(),
      consumedAt: null,
      createdAt: nowIso()
    };
    this.refreshTokens.set(record.tokenHash, record);
    return { id: record.id, expiresAt };
  }

  async consumeRefreshToken(
    token: string,
    pepper = ''
  ): Promise<{ valid: boolean; userId?: string; error?: string }> {
    const hash = sha256Hex(token + pepper);
    const record = this.refreshTokens.get(hash);
    if (!record) return { valid: false, error: 'Invalid refresh token' };
    if (record.consumedAt) return { valid: false, error: 'Refresh token already used' };
    if (record.expiresAt <= nowIso()) return { valid: false, error: 'Refresh token expired' };
    record.consumedAt = nowIso();
    return { valid: true, userId: record.userId };
  }

  async recordNotification(orderId: string, event: string): Promise<boolean> {
    const key = `${orderId}:${event}`;
    if (this.notifications.has(key)) return false;
    this.notifications.add(key);
    return true;
  }

  // --- Audit Events ---
  async logEvent(
    orderId: string | null,
    shopId: string | null,
    type: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    this.events.push({
      id: crypto.randomUUID(),
      orderId,
      shopId,
      type,
      payload,
      createdAt: nowIso()
    });
  }
}

// ============================================================================
// POSTGRESQL REPOSITORY
// ============================================================================

function mapShopRow(r: any): ShopRecord {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    ownerId: r.owner_id,
    city: r.city,
    phone: r.phone,
    gstNo: r.gst_no,
    status: r.status,
    planId: r.plan_id,
    settings: parseJson<ShopRecord['settings']>(r.settings, {}),
    createdAt: r.created_at?.toISOString?.() ?? String(r.created_at)
  };
}

function mapUserRow(r: any): UserRecord {
  return {
    id: r.id,
    email: r.email,
    phone: r.phone,
    name: r.name,
    role: r.role,
    passwordHash: r.password_hash,
    createdAt: r.created_at?.toISOString?.() ?? String(r.created_at)
  };
}

function mapAgentRow(r: any): AgentRecord {
  return {
    id: r.id,
    shopId: r.shop_id,
    name: r.name,
    tokenHash: r.token_hash,
    pairingCode: r.pairing_code,
    pairingCodeExpiresAt: r.pairing_code_expires_at?.toISOString?.() ?? r.pairing_code_expires_at,
    pairingAttempts: r.pairing_attempts,
    version: r.version,
    lastSeenAt: r.last_seen_at?.toISOString?.() ?? r.last_seen_at,
    os: r.os,
    status: r.status,
    createdAt: r.created_at?.toISOString?.() ?? String(r.created_at)
  };
}

function mapPrinterRow(r: any): PrinterRecord {
  return {
    id: r.id,
    shopId: r.shop_id,
    agentId: r.agent_id,
    systemName: r.system_name,
    displayName: r.display_name,
    capabilities: parseJson<PrinterRecord['capabilities']>(r.capabilities, {
      systemName: r.system_name,
      displayName: r.display_name,
      color: true,
      duplex: true,
      papers: ['A4']
    }),
    status: r.status,
    lastStatusAt: r.last_status_at?.toISOString?.() ?? String(r.last_status_at),
    createdAt: r.created_at?.toISOString?.() ?? String(r.created_at)
  };
}

function mapRateRow(r: any): RateCardRecord {
  return {
    id: r.id,
    shopId: r.shop_id,
    printerId: r.printer_id,
    paperSize: r.paper_size,
    colorMode: r.color_mode,
    sides: r.sides,
    pricePerPagePaise: r.price_per_page_paise,
    minOrderPaise: r.min_order_paise
  };
}

function mapOrderRow(r: any): OrderRecord {
  return {
    id: r.id,
    shopId: r.shop_id,
    token: r.token,
    publicToken: r.public_token,
    channel: r.channel,
    customerPhone: r.customer_phone,
    customerEmail: r.customer_email,
    customerWaId: r.customer_wa_id,
    status: r.status,
    subtotalPaise: r.subtotal_paise,
    feePaise: r.fee_paise,
    gstPaise: r.gst_paise,
    totalPaise: r.total_paise,
    currency: r.currency,
    idempotencyKey: r.idempotency_key,
    createdAt: r.created_at?.toISOString?.() ?? String(r.created_at),
    paidAt: r.paid_at?.toISOString?.() ?? r.paid_at ?? null,
    completedAt: r.completed_at?.toISOString?.() ?? r.completed_at ?? null,
    expiresAt: r.expires_at?.toISOString?.() ?? String(r.expires_at)
  };
}

function mapFileRow(r: any): FileRecord {
  return {
    id: r.id,
    orderId: r.order_id,
    storageKey: r.storage_key,
    originalName: r.original_name,
    mime: r.mime,
    sizeBytes: Number(r.size_bytes),
    sha256: r.sha256,
    scanStatus: r.scan_status,
    convertedPdfKey: r.converted_pdf_key,
    previewKeys: parseJson<string[]>(r.preview_keys, []),
    pageCount: r.page_count ?? 1,
    classification: parseJson<PageClassification[]>(r.classification, []),
    deleteAfter: r.delete_after?.toISOString?.() ?? String(r.delete_after),
    deletedAt: r.deleted_at?.toISOString?.() ?? r.deleted_at ?? null,
    createdAt: r.created_at?.toISOString?.() ?? String(r.created_at ?? new Date().toISOString())
  };
}

function mapOrderItemRow(r: any): OrderItemRecord {
  return {
    id: r.id,
    orderId: r.order_id,
    fileId: r.file_id,
    settings: parseJson<OrderItemRecord['settings']>(r.settings, {} as OrderItemRecord['settings']),
    pageCount: r.page_count,
    colourPages: r.colour_pages,
    bwPages: r.bw_pages,
    sheets: r.sheets,
    lineTotalPaise: r.line_total_paise,
    printerId: r.printer_id
  };
}

function mapPaymentRow(r: any): PaymentRecord {
  return {
    id: r.id,
    orderId: r.order_id,
    razorpayOrderId: r.razorpay_order_id,
    razorpayPaymentId: r.razorpay_payment_id,
    paymentLinkId: r.payment_link_id,
    status: r.status,
    method: r.method,
    amountPaise: r.amount_paise,
    signatureVerified: r.signature_verified,
    raw: parseJson<Record<string, unknown> | null>(r.raw, null),
    createdAt: r.created_at?.toISOString?.() ?? String(r.created_at)
  };
}

function mapPrintJobRow(r: any): PrintJobRecord {
  return {
    id: r.id,
    orderItemId: r.order_item_id,
    printerId: r.printer_id,
    status: r.status,
    attempts: r.attempts,
    lastError: r.last_error,
    dispatchedAt: r.dispatched_at?.toISOString?.() ?? r.dispatched_at ?? null,
    finishedAt: r.finished_at?.toISOString?.() ?? r.finished_at ?? null,
    createdAt: r.created_at?.toISOString?.() ?? String(r.created_at)
  };
}

function mapWaSessionRow(r: any): WhatsAppSessionRecord {
  return {
    id: r.id,
    waId: r.wa_id,
    shopId: r.shop_id,
    state: r.state,
    lang: r.lang,
    orderId: r.order_id,
    context: parseJson<Record<string, any>>(r.context, {}),
    lastInboundAt: r.last_inbound_at?.toISOString?.() ?? String(r.last_inbound_at),
    expiresAt: r.expires_at?.toISOString?.() ?? String(r.expires_at),
    createdAt: r.created_at?.toISOString?.() ?? String(r.created_at)
  };
}

export class PostgresDatabase implements DatabaseRepository {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 10 });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async query<T extends pg.QueryResultRow = any>(
    text: string,
    params: any[] = []
  ): Promise<pg.QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  async ping(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  // --- Shops & Users ---
  async getShopBySlug(slug: string): Promise<ShopRecord | undefined> {
    const res = await this.query('SELECT * FROM shops WHERE slug = $1', [slug]);
    return res.rows[0] ? mapShopRow(res.rows[0]) : undefined;
  }

  async getShopById(id: string): Promise<ShopRecord | undefined> {
    const res = await this.query('SELECT * FROM shops WHERE id = $1', [id]);
    return res.rows[0] ? mapShopRow(res.rows[0]) : undefined;
  }

  async getShopByOwnerId(ownerId: string): Promise<ShopRecord | undefined> {
    const res = await this.query('SELECT * FROM shops WHERE owner_id = $1 LIMIT 1', [ownerId]);
    return res.rows[0] ? mapShopRow(res.rows[0]) : undefined;
  }

  async getAllShops(): Promise<ShopRecord[]> {
    const res = await this.query('SELECT * FROM shops ORDER BY created_at ASC');
    return res.rows.map(mapShopRow);
  }

  async createShop(input: CreateShopInput): Promise<ShopRecord> {
    const res = await this.query(
      `INSERT INTO shops (slug, name, owner_id, city, phone, gst_no, status, plan_id, settings)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        input.slug,
        input.name,
        input.ownerId,
        input.city ?? 'Lucknow',
        input.phone ?? null,
        input.gstNo ?? null,
        input.status ?? 'active',
        input.planId ?? 'starter',
        JSON.stringify(input.settings ?? {})
      ]
    );
    return mapShopRow(res.rows[0]);
  }

  async updateShop(id: string, updates: Partial<ShopRecord>): Promise<ShopRecord | undefined> {
    const current = await this.getShopById(id);
    if (!current) return undefined;
    const settings = JSON.stringify({ ...current.settings, ...(updates.settings ?? {}) });
    const res = await this.query(
      `UPDATE shops SET name = $1, status = $2, phone = $3, city = $4, settings = $5
       WHERE id = $6 RETURNING *`,
      [
        updates.name ?? current.name,
        updates.status ?? current.status,
        updates.phone ?? current.phone,
        updates.city ?? current.city,
        settings,
        id
      ]
    );
    return res.rows[0] ? mapShopRow(res.rows[0]) : undefined;
  }

  async getUserByPhone(phone: string): Promise<UserRecord | undefined> {
    const normalized = normalizePhone(phone);
    const res = await this.query(
      `SELECT * FROM users
       WHERE regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') LIKE '%' || $1
       ORDER BY created_at ASC LIMIT 1`,
      [normalized]
    );
    return res.rows[0] ? mapUserRow(res.rows[0]) : undefined;
  }

  async getUserById(id: string): Promise<UserRecord | undefined> {
    const res = await this.query('SELECT * FROM users WHERE id = $1', [id]);
    return res.rows[0] ? mapUserRow(res.rows[0]) : undefined;
  }

  async createUser(input: CreateUserInput): Promise<UserRecord> {
    const res = await this.query(
      `INSERT INTO users (email, phone, name, role, password_hash)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        input.email ?? null,
        input.phone ? normalizePhone(input.phone) : null,
        input.name,
        input.role ?? 'owner',
        input.passwordHash ?? null
      ]
    );
    return mapUserRow(res.rows[0]);
  }

  // --- Agents & Printers ---
  async getPrintersByShopId(shopId: string): Promise<PrinterRecord[]> {
    const res = await this.query('SELECT * FROM printers WHERE shop_id = $1', [shopId]);
    return res.rows.map(mapPrinterRow);
  }

  async getAgentsByShopId(shopId: string): Promise<AgentRecord[]> {
    const res = await this.query('SELECT * FROM agents WHERE shop_id = $1', [shopId]);
    return res.rows.map(mapAgentRow);
  }

  async getAgentById(id: string): Promise<AgentRecord | undefined> {
    const res = await this.query('SELECT * FROM agents WHERE id = $1', [id]);
    return res.rows[0] ? mapAgentRow(res.rows[0]) : undefined;
  }

  async getAgentByToken(rawToken: string, pepper = ''): Promise<AgentRecord | undefined> {
    const hashed = sha256Hex(rawToken + pepper);
    const legacy = sha256Hex(rawToken);
    const res = await this.query(
      'SELECT * FROM agents WHERE token_hash = $1 OR token_hash = $2 LIMIT 1',
      [hashed, legacy]
    );
    return res.rows[0] ? mapAgentRow(res.rows[0]) : undefined;
  }

  async getAgentByPairingCode(code: string, pepper = ''): Promise<AgentRecord | undefined> {
    const codeHash = sha256Hex(code + pepper);
    const res = await this.query(
      `SELECT * FROM agents
       WHERE pairing_code = $1
         AND (pairing_code_expires_at IS NULL OR pairing_code_expires_at > NOW())
         AND pairing_attempts < 5
       LIMIT 1`,
      [codeHash]
    );
    return res.rows[0] ? mapAgentRow(res.rows[0]) : undefined;
  }

  async createAgent(input: {
    shopId: string;
    name: string;
    tokenHash: string;
    pairingCode: string | null;
    pairingCodeExpiresAt: string | null;
    os?: string | null;
  }): Promise<AgentRecord> {
    const res = await this.query(
      `INSERT INTO agents (shop_id, name, token_hash, pairing_code, pairing_code_expires_at, os)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        input.shopId,
        input.name,
        input.tokenHash,
        input.pairingCode,
        input.pairingCodeExpiresAt,
        input.os ?? null
      ]
    );
    return mapAgentRow(res.rows[0]);
  }

  async updateAgent(agentId: string, updates: Partial<AgentRecord>): Promise<AgentRecord | undefined> {
    const res = await this.query(
      `UPDATE agents SET
        name = COALESCE($1, name),
        status = COALESCE($2, status),
        version = COALESCE($3, version),
        os = COALESCE($4, os),
        last_seen_at = COALESCE($5, last_seen_at),
        token_hash = COALESCE($6, token_hash),
        pairing_code = $7,
        pairing_code_expires_at = $8,
        pairing_attempts = COALESCE($9, pairing_attempts)
       WHERE id = $10 RETURNING *`,
      [
        updates.name ?? null,
        updates.status ?? null,
        updates.version ?? null,
        updates.os ?? null,
        updates.lastSeenAt ?? null,
        updates.tokenHash ?? null,
        updates.pairingCode === undefined ? null : updates.pairingCode,
        updates.pairingCodeExpiresAt === undefined ? null : updates.pairingCodeExpiresAt,
        updates.pairingAttempts ?? null,
        agentId
      ]
    );
    return res.rows[0] ? mapAgentRow(res.rows[0]) : undefined;
  }

  async incrementPairingAttempt(agentId: string): Promise<void> {
    await this.query('UPDATE agents SET pairing_attempts = pairing_attempts + 1 WHERE id = $1', [
      agentId
    ]);
  }

  async updatePrinterStatus(printerId: string, status: PrinterStatus): Promise<PrinterRecord | undefined> {
    const res = await this.query(
      'UPDATE printers SET status = $1, last_status_at = NOW() WHERE id = $2 RETURNING *',
      [status, printerId]
    );
    return res.rows[0] ? mapPrinterRow(res.rows[0]) : undefined;
  }

  async upsertPrintersForAgent(
    agentId: string,
    shopId: string,
    printers: PrinterRecord['capabilities'][]
  ): Promise<void> {
    for (const cap of printers) {
      await this.query(
        `INSERT INTO printers (shop_id, agent_id, system_name, display_name, capabilities, status, last_status_at)
         VALUES ($1, $2, $3, $4, $5, 'online', NOW())
         ON CONFLICT (agent_id, system_name) DO UPDATE
           SET display_name = EXCLUDED.display_name,
               capabilities = EXCLUDED.capabilities,
               status = 'online',
               last_status_at = NOW()`,
        [shopId, agentId, cap.systemName, cap.displayName, JSON.stringify(cap)]
      );
    }
  }

  // --- Rate Cards ---
  async getRateCardsByShopId(shopId: string): Promise<RateCardRecord[]> {
    const res = await this.query('SELECT * FROM rate_cards WHERE shop_id = $1', [shopId]);
    return res.rows.map(mapRateRow);
  }

  async saveRateCards(shopId: string, rates: RateCardRecord[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM rate_cards WHERE shop_id = $1', [shopId]);
      for (const r of rates) {
        await client.query(
          `INSERT INTO rate_cards (shop_id, paper_size, color_mode, sides, price_per_page_paise, min_order_paise)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (shop_id, paper_size, color_mode, sides)
           DO UPDATE SET price_per_page_paise = EXCLUDED.price_per_page_paise`,
          [
            shopId,
            r.paperSize,
            r.colorMode,
            r.sides,
            r.pricePerPagePaise,
            r.minOrderPaise ?? 500
          ]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // --- Orders ---
  async createOrder(data: {
    shopId: string;
    customerPhone?: string | null;
    customerEmail?: string | null;
    customerWaId?: string | null;
    channel?: OrderChannel;
    idempotencyKey: string;
  }): Promise<OrderRecord> {
    const existing = await this.query('SELECT * FROM orders WHERE idempotency_key = $1', [
      data.idempotencyKey
    ]);
    if (existing.rows[0]) return mapOrderRow(existing.rows[0]);

    const res = await this.query(
      `INSERT INTO orders (shop_id, token, public_token, channel, customer_phone, customer_email, customer_wa_id, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        data.shopId,
        generatePickupToken(),
        generatePublicToken(),
        data.channel ?? 'web',
        data.customerPhone ?? null,
        data.customerEmail ?? null,
        data.customerWaId ?? null,
        data.idempotencyKey
      ]
    );
    const order = mapOrderRow(res.rows[0]);
    await this.logEvent(order.id, order.shopId, 'order.created', {
      orderId: order.id,
      token: order.token,
      channel: order.channel
    });
    return order;
  }

  async getOrderById(id: string): Promise<OrderRecord | undefined> {
    const res = await this.query('SELECT * FROM orders WHERE id = $1', [id]);
    return res.rows[0] ? mapOrderRow(res.rows[0]) : undefined;
  }

  async getOrderByPublicToken(publicToken: string): Promise<OrderRecord | undefined> {
    const res = await this.query('SELECT * FROM orders WHERE public_token = $1', [publicToken]);
    return res.rows[0] ? mapOrderRow(res.rows[0]) : undefined;
  }

  async getOrdersByShopId(shopId: string): Promise<OrderRecord[]> {
    const res = await this.query(
      'SELECT * FROM orders WHERE shop_id = $1 ORDER BY created_at DESC',
      [shopId]
    );
    return res.rows.map(mapOrderRow);
  }

  async getLastOrderByWaId(waId: string): Promise<OrderRecord | undefined> {
    const res = await this.query(
      'SELECT * FROM orders WHERE customer_wa_id = $1 ORDER BY created_at DESC LIMIT 1',
      [waId]
    );
    return res.rows[0] ? mapOrderRow(res.rows[0]) : undefined;
  }

  async updateOrderTotals(
    orderId: string,
    totals: { subtotalPaise: number; feePaise: number; gstPaise: number; totalPaise: number }
  ): Promise<OrderRecord | undefined> {
    const res = await this.query(
      `UPDATE orders SET subtotal_paise = $1, fee_paise = $2, gst_paise = $3, total_paise = $4
       WHERE id = $5 RETURNING *`,
      [totals.subtotalPaise, totals.feePaise, totals.gstPaise, totals.totalPaise, orderId]
    );
    return res.rows[0] ? mapOrderRow(res.rows[0]) : undefined;
  }

  async transitionOrderStatus(
    orderId: string,
    to: OrderStatus,
    metadata?: Record<string, unknown>
  ): Promise<{ success: boolean; order?: OrderRecord; error?: string }> {
    const current = await this.getOrderById(orderId);
    if (!current) return { success: false, error: 'Order not found' };
    if (!canTransitionOrder(current.status, to)) {
      return { success: false, error: `Cannot transition order from '${current.status}' to '${to}'` };
    }

    const res = await this.query(
      `UPDATE orders SET status = $1,
        paid_at = CASE WHEN $1 = 'paid' THEN NOW() ELSE paid_at END,
        completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE completed_at END
       WHERE id = $2 AND status = $3 RETURNING *`,
      [to, orderId, current.status]
    );
    if (res.rowCount === 0) {
      return { success: false, error: 'Concurrent status transition conflict' };
    }

    const order = mapOrderRow(res.rows[0]);
    await this.logEvent(orderId, order.shopId, `order.status.${to}`, {
      orderId,
      previousStatus: current.status,
      newStatus: to,
      ...(metadata ?? {})
    });
    return { success: true, order };
  }

  async getOrdersAwaitingPaymentExpired(olderThanDate: Date): Promise<OrderRecord[]> {
    const res = await this.query(
      `SELECT * FROM orders WHERE status = 'awaiting_payment' AND created_at < $1`,
      [olderThanDate]
    );
    return res.rows.map(mapOrderRow);
  }

  // --- Files & Order Items ---
  async addFile(file: Omit<FileRecord, 'id' | 'createdAt'>): Promise<FileRecord> {
    const res = await this.query(
      `INSERT INTO files (order_id, storage_key, original_name, mime, size_bytes, sha256,
        scan_status, converted_pdf_key, preview_keys, page_count, classification, delete_after)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        file.orderId,
        file.storageKey,
        file.originalName,
        file.mime,
        file.sizeBytes,
        file.sha256,
        file.scanStatus,
        file.convertedPdfKey,
        JSON.stringify(file.previewKeys),
        file.pageCount,
        JSON.stringify(file.classification),
        file.deleteAfter
      ]
    );
    return mapFileRow(res.rows[0]);
  }

  async getFileById(id: string): Promise<FileRecord | undefined> {
    const res = await this.query('SELECT * FROM files WHERE id = $1', [id]);
    return res.rows[0] ? mapFileRow(res.rows[0]) : undefined;
  }

  async updateFile(id: string, updates: Partial<FileRecord>): Promise<FileRecord | undefined> {
    const current = await this.getFileById(id);
    if (!current) return undefined;
    const merged = { ...current, ...updates };
    const res = await this.query(
      `UPDATE files SET order_id = $1, storage_key = $2, original_name = $3, mime = $4,
        size_bytes = $5, sha256 = $6, scan_status = $7, converted_pdf_key = $8,
        preview_keys = $9, page_count = $10, classification = $11, delete_after = $12,
        deleted_at = $13
       WHERE id = $14 RETURNING *`,
      [
        merged.orderId,
        merged.storageKey,
        merged.originalName,
        merged.mime,
        merged.sizeBytes,
        merged.sha256,
        merged.scanStatus,
        merged.convertedPdfKey,
        JSON.stringify(merged.previewKeys),
        merged.pageCount,
        JSON.stringify(merged.classification),
        merged.deleteAfter,
        merged.deletedAt,
        id
      ]
    );
    return res.rows[0] ? mapFileRow(res.rows[0]) : undefined;
  }

  async getFilesPendingDeletion(now: Date): Promise<FileRecord[]> {
    const res = await this.query(
      'SELECT * FROM files WHERE deleted_at IS NULL AND delete_after <= $1 ORDER BY delete_after ASC LIMIT 100',
      [now]
    );
    return res.rows.map(mapFileRow);
  }

  async markFileDeleted(fileId: string): Promise<boolean> {
    const res = await this.query(
      'UPDATE files SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [fileId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async addOrderItem(item: Omit<OrderItemRecord, 'id'>): Promise<OrderItemRecord> {
    const res = await this.query(
      `INSERT INTO order_items (order_id, file_id, settings, page_count, colour_pages, bw_pages, sheets, line_total_paise)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        item.orderId,
        item.fileId,
        JSON.stringify(item.settings),
        item.pageCount,
        item.colourPages,
        item.bwPages,
        item.sheets,
        item.lineTotalPaise
      ]
    );
    return mapOrderItemRow(res.rows[0]);
  }

  async getOrderItemById(id: string): Promise<OrderItemRecord | undefined> {
    const res = await this.query('SELECT * FROM order_items WHERE id = $1', [id]);
    return res.rows[0] ? mapOrderItemRow(res.rows[0]) : undefined;
  }

  async getOrderItemsByOrderId(orderId: string): Promise<OrderItemRecord[]> {
    const res = await this.query('SELECT * FROM order_items WHERE order_id = $1', [orderId]);
    return res.rows.map(mapOrderItemRow);
  }

  async updateOrderItem(
    id: string,
    updates: Partial<OrderItemRecord>
  ): Promise<OrderItemRecord | undefined> {
    const current = await this.getOrderItemById(id);
    if (!current) return undefined;
    const merged = { ...current, ...updates };
    const res = await this.query(
      `UPDATE order_items SET settings = $1, colour_pages = $2, bw_pages = $3,
        sheets = $4, line_total_paise = $5, printer_id = $6
       WHERE id = $7 RETURNING *`,
      [
        JSON.stringify(merged.settings),
        merged.colourPages,
        merged.bwPages,
        merged.sheets,
        merged.lineTotalPaise,
        merged.printerId,
        id
      ]
    );
    return res.rows[0] ? mapOrderItemRow(res.rows[0]) : undefined;
  }

  // --- Payments ---
  async createPayment(payment: Omit<PaymentRecord, 'id' | 'createdAt'>): Promise<PaymentRecord> {
    const existing = await this.getPaymentByOrderId(payment.orderId);
    if (existing && existing.status === 'created') {
      const updated = await this.updatePayment(existing.id, {
        razorpayOrderId: payment.razorpayOrderId,
        paymentLinkId: payment.paymentLinkId,
        amountPaise: payment.amountPaise,
        method: payment.method
      });
      return updated ?? existing;
    }
    const res = await this.query(
      `INSERT INTO payments (order_id, razorpay_order_id, razorpay_payment_id, payment_link_id,
        status, method, amount_paise, signature_verified, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        payment.orderId,
        payment.razorpayOrderId,
        payment.razorpayPaymentId ?? null,
        payment.paymentLinkId ?? null,
        payment.status,
        payment.method ?? null,
        payment.amountPaise,
        payment.signatureVerified,
        JSON.stringify(payment.raw ?? {})
      ]
    );
    return mapPaymentRow(res.rows[0]);
  }

  async updatePayment(
    id: string,
    updates: Partial<PaymentRecord>
  ): Promise<PaymentRecord | undefined> {
    const currentRes = await this.query('SELECT * FROM payments WHERE id = $1', [id]);
    if (!currentRes.rows[0]) return undefined;
    const current = mapPaymentRow(currentRes.rows[0]);
    const merged = { ...current, ...updates };
    const res = await this.query(
      `UPDATE payments SET razorpay_payment_id = $1, payment_link_id = $2, status = $3,
        method = $4, amount_paise = $5, signature_verified = $6, raw = $7
       WHERE id = $8 RETURNING *`,
      [
        merged.razorpayPaymentId,
        merged.paymentLinkId,
        merged.status,
        merged.method,
        merged.amountPaise,
        merged.signatureVerified,
        JSON.stringify(merged.raw ?? {}),
        id
      ]
    );
    return res.rows[0] ? mapPaymentRow(res.rows[0]) : undefined;
  }

  async getPaymentByOrderId(orderId: string): Promise<PaymentRecord | undefined> {
    const res = await this.query(
      'SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1',
      [orderId]
    );
    return res.rows[0] ? mapPaymentRow(res.rows[0]) : undefined;
  }

  async getPaymentByRazorpayOrderId(rzpOrderId: string): Promise<PaymentRecord | undefined> {
    const res = await this.query('SELECT * FROM payments WHERE razorpay_order_id = $1', [rzpOrderId]);
    return res.rows[0] ? mapPaymentRow(res.rows[0]) : undefined;
  }

  async getPaymentByPaymentLinkId(linkId: string): Promise<PaymentRecord | undefined> {
    const res = await this.query('SELECT * FROM payments WHERE payment_link_id = $1', [linkId]);
    return res.rows[0] ? mapPaymentRow(res.rows[0]) : undefined;
  }

  async recordWebhookEvent(
    provider: string,
    eventId: string,
    payload: Record<string, unknown>
  ): Promise<boolean> {
    try {
      await this.query(
        'INSERT INTO webhook_events (provider, event_id, payload) VALUES ($1, $2, $3)',
        [provider, eventId, JSON.stringify(payload)]
      );
      return true;
    } catch (err: any) {
      if (err.code === '23505') return false;
      throw err;
    }
  }

  // --- Print Jobs ---
  async createPrintJob(
    data: Omit<
      PrintJobRecord,
      'id' | 'createdAt' | 'attempts' | 'lastError' | 'dispatchedAt' | 'finishedAt'
    >
  ): Promise<PrintJobRecord> {
    const res = await this.query(
      `INSERT INTO print_jobs (order_item_id, printer_id, status) VALUES ($1, $2, $3) RETURNING *`,
      [data.orderItemId, data.printerId ?? null, data.status]
    );
    return mapPrintJobRow(res.rows[0]);
  }

  async getPrintJobById(id: string): Promise<PrintJobRecord | undefined> {
    const res = await this.query('SELECT * FROM print_jobs WHERE id = $1', [id]);
    return res.rows[0] ? mapPrintJobRow(res.rows[0]) : undefined;
  }

  async getPrintJobsByOrderItemId(orderItemId: string): Promise<PrintJobRecord[]> {
    const res = await this.query('SELECT * FROM print_jobs WHERE order_item_id = $1', [
      orderItemId
    ]);
    return res.rows.map(mapPrintJobRow);
  }

  async getPendingPrintJobsForShop(
    shopId: string
  ): Promise<Array<{ job: PrintJobRecord; item: OrderItemRecord; file: FileRecord; order: OrderRecord }>> {
    const jobRes = await this.query(
      `SELECT j.* FROM print_jobs j
       JOIN order_items i ON j.order_item_id = i.id
       JOIN orders o ON i.order_id = o.id
       WHERE o.shop_id = $1 AND j.status IN ('pending', 'dispatched')
       ORDER BY j.created_at ASC`,
      [shopId]
    );

    const results: Array<{
      job: PrintJobRecord;
      item: OrderItemRecord;
      file: FileRecord;
      order: OrderRecord;
    }> = [];

    for (const jobRow of jobRes.rows) {
      const job = mapPrintJobRow(jobRow);
      const item = await this.getOrderItemById(job.orderItemId);
      if (!item) continue;
      const order = await this.getOrderById(item.orderId);
      if (!order) continue;
      const file = await this.getFileById(item.fileId);
      if (!file) continue;
      results.push({ job, item, file, order });
    }
    return results;
  }

  async updatePrintJob(
    id: string,
    updates: Partial<PrintJobRecord>
  ): Promise<PrintJobRecord | undefined> {
    const currentRes = await this.query('SELECT * FROM print_jobs WHERE id = $1', [id]);
    if (!currentRes.rows[0]) return undefined;
    const current = mapPrintJobRow(currentRes.rows[0]);
    const merged = { ...current, ...updates };
    const res = await this.query(
      `UPDATE print_jobs SET status = $1, attempts = $2, last_error = $3,
        dispatched_at = $4, finished_at = $5 WHERE id = $6 RETURNING *`,
      [
        merged.status,
        merged.attempts,
        merged.lastError,
        merged.dispatchedAt,
        merged.finishedAt,
        id
      ]
    );
    return res.rows[0] ? mapPrintJobRow(res.rows[0]) : undefined;
  }

  // --- WhatsApp ---
  async getActiveWaSession(waId: string): Promise<WhatsAppSessionRecord | undefined> {
    const res = await this.query(
      `SELECT * FROM wa_sessions WHERE wa_id = $1 AND state <> 'DONE' AND expires_at > NOW() LIMIT 1`,
      [waId]
    );
    return res.rows[0] ? mapWaSessionRow(res.rows[0]) : undefined;
  }

  async getWaSessionByOrderId(orderId: string): Promise<WhatsAppSessionRecord | undefined> {
    const res = await this.query(
      `SELECT * FROM wa_sessions WHERE order_id = $1 AND state <> 'DONE' LIMIT 1`,
      [orderId]
    );
    return res.rows[0] ? mapWaSessionRow(res.rows[0]) : undefined;
  }

  async saveWaSession(session: WhatsAppSessionRecord): Promise<void> {
    await this.query(
      `UPDATE wa_sessions SET state = 'DONE'
       WHERE wa_id = $1 AND id <> $2 AND state <> 'DONE'`,
      [session.waId, session.id]
    );
    await this.query(
      `INSERT INTO wa_sessions (id, wa_id, shop_id, state, lang, order_id, context, last_inbound_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
        state = $4, lang = $5, order_id = $6, context = $7, last_inbound_at = $8, expires_at = $9`,
      [
        session.id,
        session.waId,
        session.shopId,
        session.state,
        session.lang,
        session.orderId,
        JSON.stringify(session.context),
        session.lastInboundAt,
        session.expiresAt
      ]
    );
  }

  async expireInactiveWaSessions(now: Date): Promise<WhatsAppSessionRecord[]> {
    const res = await this.query(
      `UPDATE wa_sessions SET state = 'DONE' WHERE expires_at <= $1 AND state <> 'DONE' RETURNING *`,
      [now]
    );
    return res.rows.map(mapWaSessionRow);
  }

  async recordWaMessage(
    message: Omit<WhatsAppMessageRecord, 'id' | 'createdAt'>
  ): Promise<WhatsAppMessageRecord> {
    const res = await this.query(
      `INSERT INTO wa_messages (wamid, direction, wa_id, type, payload, status, order_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (wamid) DO UPDATE SET status = EXCLUDED.status
       RETURNING *`,
      [
        message.wamid,
        message.direction,
        message.waId,
        message.type,
        JSON.stringify(message.payload),
        message.status,
        message.orderId
      ]
    );
    const r = res.rows[0];
    return {
      id: r.id,
      wamid: r.wamid,
      direction: r.direction,
      waId: r.wa_id,
      type: r.type,
      payload: parseJson<Record<string, any>>(r.payload, {}),
      status: r.status,
      orderId: r.order_id,
      createdAt: r.created_at?.toISOString?.() ?? String(r.created_at)
    };
  }

  async isWaMessageProcessed(wamid: string): Promise<boolean> {
    const res = await this.query('SELECT 1 FROM wa_messages WHERE wamid = $1', [wamid]);
    return (res.rowCount ?? 0) > 0;
  }

  async updateWaMessageStatus(wamid: string, status: string): Promise<void> {
    await this.query('UPDATE wa_messages SET status = $1 WHERE wamid = $2', [status, wamid]);
  }

  async recordWaStatus(wamid: string, status: string): Promise<boolean> {
    const res = await this.query(
      'INSERT INTO wa_status_events (wamid, status) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [wamid, status]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async purgeOldWaMessages(before: Date): Promise<number> {
    const res = await this.query('DELETE FROM wa_messages WHERE created_at < $1', [before]);
    return res.rowCount ?? 0;
  }

  async isOptedOut(waId: string): Promise<boolean> {
    const res = await this.query('SELECT 1 FROM wa_optouts WHERE wa_id = $1', [waId]);
    return (res.rowCount ?? 0) > 0;
  }

  async setOptOut(waId: string): Promise<void> {
    await this.query('INSERT INTO wa_optouts (wa_id) VALUES ($1) ON CONFLICT DO NOTHING', [waId]);
  }

  async clearOptOut(waId: string): Promise<void> {
    await this.query('DELETE FROM wa_optouts WHERE wa_id = $1', [waId]);
  }

  // --- OTP & refresh tokens ---
  async createOtp(phone: string, code: string, pepper = ''): Promise<{ id: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const res = await this.query(
      'INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES ($1, $2, $3) RETURNING id',
      [normalizePhone(phone), sha256Hex(code + pepper), expiresAt]
    );
    return { id: res.rows[0].id, expiresAt };
  }

  async verifyOtp(phone: string, code: string, pepper = ''): Promise<{ valid: boolean; error?: string }> {
    const normalized = normalizePhone(phone);
    const res = await this.query(
      `SELECT * FROM otp_codes WHERE phone = $1 AND consumed_at IS NULL AND expires_at > NOW()
       ORDER BY expires_at DESC LIMIT 1`,
      [normalized]
    );
    const match = res.rows[0];
    if (!match) return { valid: false, error: 'No active OTP found. Please request a new one.' };
    if (match.attempts >= 5) {
      return { valid: false, error: 'Too many invalid attempts. Please request a new OTP.' };
    }
    if (match.code_hash !== sha256Hex(code + pepper)) {
      await this.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [match.id]);
      return { valid: false, error: 'Invalid verification code.' };
    }
    await this.query('UPDATE otp_codes SET consumed_at = NOW() WHERE id = $1', [match.id]);
    return { valid: true };
  }

  async createRefreshToken(
    userId: string,
    token: string,
    pepper = '',
    ttlSeconds = 30 * 86400
  ): Promise<{ id: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const res = await this.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3) RETURNING id',
      [userId, sha256Hex(token + pepper), expiresAt]
    );
    return { id: res.rows[0].id, expiresAt };
  }

  async consumeRefreshToken(
    token: string,
    pepper = ''
  ): Promise<{ valid: boolean; userId?: string; error?: string }> {
    const hash = sha256Hex(token + pepper);
    const res = await this.query(
      `UPDATE refresh_tokens SET consumed_at = NOW()
       WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > NOW()
       RETURNING user_id`,
      [hash]
    );
    if (!res.rows[0]) return { valid: false, error: 'Invalid or expired refresh token' };
    return { valid: true, userId: res.rows[0].user_id };
  }

  async recordNotification(orderId: string, event: string): Promise<boolean> {
    try {
      await this.query('INSERT INTO notification_log (order_id, event) VALUES ($1, $2)', [
        orderId,
        event
      ]);
      return true;
    } catch (err: any) {
      if (err.code === '23505') return false;
      throw err;
    }
  }

  // --- Audit Events ---
  async logEvent(
    orderId: string | null,
    shopId: string | null,
    type: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.query(
      'INSERT INTO events (order_id, shop_id, type, payload) VALUES ($1, $2, $3, $4)',
      [orderId, shopId, type, JSON.stringify(payload)]
    );
  }
}

// ============================================================================
// GLOBAL INSTANCE SELECTION
// ============================================================================

let globalDb: DatabaseRepository | null = null;

export function getDatabase(forceType?: 'memory' | 'postgres'): DatabaseRepository {
  if (globalDb) return globalDb;
  const configured = forceType ?? (process.env.DB_MODE as 'memory' | 'postgres' | undefined);
  const wantsPostgres =
    configured === 'postgres' ||
    (configured === undefined && Boolean(process.env.DATABASE_URL) && process.env.NODE_ENV !== 'test');
  globalDb = wantsPostgres && process.env.DATABASE_URL
    ? new PostgresDatabase(process.env.DATABASE_URL)
    : new MemoryDatabase();
  return globalDb;
}

/** Test helper: forget the singleton so a new DB can be created. */
export function resetDatabaseSingleton(): void {
  globalDb = null;
}

export const db: DatabaseRepository = getDatabase();
