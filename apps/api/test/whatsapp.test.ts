import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  FakeAgent,
  createWebOrder,
  makeTestPdf,
  postWhatsApp,
  readJson,
  resetWaCounter,
  rupeeTotal,
  uploadFile,
  waitFor,
  waButton,
  waDocument,
  waMessage,
  waText
} from './helpers.js';

const dataDir = path.join(os.tmpdir(), `chhaap-wa-test-${crypto.randomUUID()}`);
const jwtSecret = 'test_jwt_secret_at_least_32_characters_long';
const appSecret = 'test_wa_app_secret';
const verifyToken = 'test_wa_verify_token';

process.env.NODE_ENV = 'test';
process.env.DB_MODE = 'memory';
process.env.PAYMENTS_MODE = 'simulated';
process.env.WHATSAPP_MODE = 'mock';
process.env.JWT_SECRET = jwtSecret;
process.env.WHATSAPP_APP_SECRET = appSecret;
process.env.WHATSAPP_VERIFY_TOKEN = verifyToken;
process.env.CHHAAP_DATA_DIR = dataDir;
process.env.LOG_LEVEL = 'silent';

let app: any;
let baseUrl = '';
let wsUrl = '';
let pdf: Buffer;
let db: any;
let handler: any;
let provider: any;
let ownerAlerts: any;
let gateway: any;
let config: any;
let limiters: any;
let agent: FakeAgent;
let agent2: FakeAgent | undefined;

async function send(waId: string, message: Record<string, unknown>, wamid?: string): Promise<Response> {
  const raw = waMessage({ from: waId, ...message, ...(wamid ? { id: wamid } : {}) });
  const res = await postWhatsApp(baseUrl, raw);
  await handler.waitForIdle();
  return res;
}

async function sendText(waId: string, body: string, wamid?: string): Promise<void> {
  const res = await send(waId, waText(waId, body, wamid));
  assert.equal(res.status, 200);
}

async function sendButton(waId: string, id: string, title: string): Promise<void> {
  const res = await send(waId, waButton(waId, id, title));
  assert.equal(res.status, 200);
}

async function sendDoc(waId: string, mediaId: string, filename = 'assignment.pdf'): Promise<void> {
  const res = await send(waId, waDocument(waId, mediaId, filename));
  assert.equal(res.status, 200);
}

function messagesFor(waId: string, from = 0): any[] {
  return provider.outbound.slice(from).filter((m: any) => m.to === waId);
}

function bodyText(messages: any[]): string {
  return messages.map((m) => `${m.body ?? ''} ${m.templateName ?? ''}`).join('\n');
}

async function waitForMessage(
  waId: string,
  from: number,
  matcher: RegExp,
  label: string
): Promise<any[]> {
  await waitFor(
    () => {
      const messages = messagesFor(waId, from);
      return matcher.test(bodyText(messages)) ? messages : false;
    },
    label
  );
  return messagesFor(waId, from);
}

async function setupSession(waId: string): Promise<number> {
  const index = provider.outbound.length;
  await sendText(waId, 'PRINT campus-xerox');
  await waitForMessage(waId, index, /choose your language|bhasha|भाषा/i, 'language prompt');
  await sendButton(waId, 'lang_en', 'English');
  await waitForMessage(waId, index, /send the PDF or image/i, 'ask file');
  return index;
}

before(async () => {
  await fs.mkdir(dataDir, { recursive: true });
  pdf = await makeTestPdf(dataDir);
  resetWaCounter();

  const serverModule = await import('../dist/server.js');
  const dbModule = await import('@chhaap/db');
  const configModule = await import('../dist/config.js');
  const webhookModule = await import('../dist/whatsapp/webhook.js');
  const mockModule = await import('../dist/whatsapp/mock-provider.js');
  const gatewayModule = await import('../dist/websocket-gateway.js');
  const rateLimitModule = await import('../dist/rate-limit.js');
  const alertsModule = await import('../dist/whatsapp/owner-alerts.js');

  db = dbModule.db;
  config = configModule.loadConfig();
  handler = webhookModule.whatsAppWebhookHandler;
  provider = mockModule.mockWhatsAppProvider;
  gateway = gatewayModule.gateway;
  limiters = rateLimitModule.limiters;
  ownerAlerts = alertsModule.shopOwnerAlerts;

  app = await serverModule.buildServer();
  baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  process.env.PUBLIC_BASE_URL = baseUrl;
  wsUrl = `${baseUrl.replace(/^http/, 'ws')}/v1/agent/connect`;

  agent = new FakeAgent(wsUrl);
  await agent.connect();
  await waitFor(
    async () => {
      const res = await fetch(`${baseUrl}/v1/shops/campus-xerox`);
      return (await readJson(res)).shop.printerOnline;
    },
    'agent online'
  );
});

after(async () => {
  await agent?.close();
  await agent2?.close();
  await app?.close();
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('B4 webhook security', () => {
  it('completes the GET verification handshake and rejects a wrong token', async () => {
    const ok = await fetch(
      `${baseUrl}/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=challenge-123`
    );
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), 'challenge-123');

    const bad = await fetch(
      `${baseUrl}/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x`
    );
    assert.equal(bad.status, 403);
  });

  it('rejects missing and tampered signatures before any side effect', async () => {
    const raw = waMessage(waText('919000000100', 'PRINT campus-xerox'));
    const countBefore = provider.outbound.length;

    const missing = await fetch(`${baseUrl}/v1/webhooks/whatsapp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw
    });
    assert.equal(missing.status, 401);

    const tampered = await fetch(`${baseUrl}/v1/webhooks/whatsapp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=deadbeef'
      },
      body: raw
    });
    assert.equal(tampered.status, 401);
    await handler.waitForIdle();
    assert.equal(provider.outbound.length, countBefore);
  });

  it('processes a duplicate wamid exactly once', async () => {
    const waId = '919000000101';
    const wamid = `wamid.duplicate.${Date.now()}`;
    const raw = waMessage(waText(waId, 'PRINT campus-xerox', wamid));
    const countBefore = provider.outbound.length;

    const first = await postWhatsApp(baseUrl, raw);
    assert.equal(first.status, 200);
    await handler.waitForIdle();
    const afterFirst = provider.outbound.length;
    assert.ok(afterFirst > countBefore);

    const second = await postWhatsApp(baseUrl, raw);
    assert.equal(second.status, 200);
    await handler.waitForIdle();
    assert.equal(provider.outbound.length, afterFirst);
    await sendText(waId, 'CANCEL');
  });
});

describe('B5/B7 full WhatsApp order E2E (mock provider)', () => {
  it('orders, pays a payment link and receives paid → printing → ready messages', async () => {
    const waId = '919000000201';
    const index = await setupSession(waId);

    const mediaId = `media-${Date.now()}`;
    provider.registerMockMedia(mediaId, pdf, 'application/pdf', 'assignment.pdf');
    await sendDoc(waId, mediaId);
    await waitForMessage(waId, index, /pages.*colour|colour pages/i, 'file analysis');
    await waitForMessage(waId, index, /select colour mode/i, 'colour choices');

    const session = await db.getActiveWaSession(waId);
    assert.equal(session.state, 'CONFIGURING');
    assert.equal(session.context.step, 'color');

    await sendButton(waId, 'color_bw', 'All B&W');
    await waitForMessage(waId, index, /select sides/i, 'sides choices');
    await sendButton(waId, 'sides_duplex', 'Back-to-Back');
    await waitForMessage(waId, index, /select number of copies/i, 'copies list');
    await sendButton(waId, 'copies_2', '2 Copies');
    const reviewMessages = await waitForMessage(waId, index, /Order Summary/i, 'order review');
    const review = reviewMessages.find((m) => /Order Summary/i.test(m.body ?? ''));
    assert.ok(review);
    const reviewTotal = rupeeTotal(review.body);

    await sendButton(waId, 'pay_now', 'Pay now');
    const paymentMessages = await waitForMessage(waId, index, /pay ₹/i, 'payment link');
    const linkMessage = paymentMessages.find((m) => /\/pay\/plink_sim_/.test(m.body ?? ''));
    assert.ok(linkMessage, bodyText(paymentMessages));
    const match = linkMessage.body.match(/\/pay\/(plink_sim_[a-z0-9-]+)/i);
    assert.ok(match, linkMessage.body);
    const linkId = match[1];

    const linkInfo = await readJson(await fetch(`${baseUrl}/v1/pay/${linkId}`));
    assert.equal(linkInfo.amountPaise, reviewTotal);
    assert.equal(linkInfo.status, 'awaiting_payment');

    const paid = await fetch(`${baseUrl}/v1/pay/${linkId}/pay`, { method: 'POST' });
    assert.equal(paid.status, 200, JSON.stringify(await readJson(paid).catch(() => ({}))));

    const sessionRow = await db.getActiveWaSession(waId);
    const order = await waitFor(
      async () => {
        const row = db.waSessions.get(waId);
        const current = row?.orderId ? await db.getOrderById(row.orderId) : undefined;
        return current?.status === 'completed' ? current : false;
      },
      'completed WhatsApp order'
    );
    assert.equal(order.channel, 'whatsapp');
    assert.equal(order.customerWaId, waId);

    const afterPay = messagesFor(waId, index);
    const text = bodyText(afterPay);
    assert.match(text, /Receipt/);
    assert.match(text, /Printing started/i);
    assert.match(text, /Print Ready/i);
    const receiptAt = afterPay.findIndex((m) => /Receipt/.test(m.body ?? ''));
    const printingAt = afterPay.findIndex((m) => /Printing started/i.test(m.body ?? ''));
    const readyAt = afterPay.findIndex((m) => /Print Ready/i.test(m.body ?? ''));
    assert.ok(receiptAt >= 0 && printingAt > receiptAt && readyAt > printingAt);
    assert.ok(sessionRow);
    assert.equal(db.waSessions.get(waId).state, 'DONE');
    assert.ok(agent.dispatches.some((d) => d.documentName === 'assignment.pdf'));
  });

  it('refuses to start an order while the printer is offline', async () => {
    await agent.close();
    await waitFor(async () => !gateway.isShopAgentOnline('shop-campus-xerox'), 'agent offline');

    const waId = '919000000202';
    const index = provider.outbound.length;
    await sendText(waId, 'PRINT campus-xerox');
    const messages = await waitForMessage(waId, index, /printer.*offline/i, 'printer offline');
    assert.match(bodyText(messages), /offline/i);
    assert.equal(await db.getActiveWaSession(waId), undefined);

    agent = new FakeAgent(wsUrl);
    await agent.connect();
    await waitFor(
      async () => {
        const res = await fetch(`${baseUrl}/v1/shops/campus-xerox`);
        return (await readJson(res)).shop.printerOnline;
      },
      'agent back online'
    );
  });
});

describe('B5/B15 file errors, opt-out, cancellation and session expiry', () => {
  it('handles encrypted, oversized and unknown media without corrupting state', async () => {
    const waId = '919000000301';
    const index = await setupSession(waId);

    const unknown = await send(
      waId,
      waDocument(waId, 'media-does-not-exist', 'missing.pdf')
    );
    assert.equal(unknown.status, 200);
    await waitForMessage(waId, index, /could not accept that file|File accept nahi/i, 'unknown media error');
    assert.equal((await db.getActiveWaSession(waId)).state, 'AWAITING_FILE');

    const encryptedId = `media-encrypted-${Date.now()}`;
    provider.registerMockMedia(
      encryptedId,
      Buffer.from('%PDF-1.7\n1 0 obj << /Encrypt 2 0 R >> endobj\n%%EOF'),
      'application/pdf',
      'locked.pdf'
    );
    await sendDoc(waId, encryptedId, 'locked.pdf');
    await waitForMessage(waId, index, /Password-protected/i, 'encrypted PDF error');
    assert.equal((await db.getActiveWaSession(waId)).state, 'AWAITING_FILE');

    const hugeId = `media-huge-${Date.now()}`;
    const huge = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(4096, 0x20)]);
    provider.registerMockMedia(hugeId, huge, 'application/pdf', 'huge.pdf');
    process.env.MAX_UPLOAD_MB = '0.001';
    try {
      await sendDoc(waId, hugeId, 'huge.pdf');
      await waitForMessage(waId, index, /maximum allowed size|exceeds/i, 'oversized error');
    } finally {
      delete process.env.MAX_UPLOAD_MB;
    }
    assert.equal((await db.getActiveWaSession(waId)).state, 'AWAITING_FILE');

    // A valid file afterwards proves the conversation is still usable.
    const validId = `media-valid-${Date.now()}`;
    provider.registerMockMedia(validId, pdf, 'application/pdf', 'assignment.pdf');
    await sendDoc(waId, validId);
    await waitFor(
      async () => (await db.getActiveWaSession(waId))?.state === 'CONFIGURING',
      'state recovers to CONFIGURING'
    );
    await sendText(waId, 'CANCEL');
  });

  it('honours STOP, START, help and cancel commands', async () => {
    const waId = '919000000302';
    const index = provider.outbound.length;

    await sendText(waId, 'STOP');
    await waitForMessage(waId, index, /stop kar di|unsubscribed/i, 'opt-out confirmation');
    assert.equal(await db.isOptedOut(waId), true);

    const afterStop = provider.outbound.length;
    await sendText(waId, 'PRINT campus-xerox');
    assert.equal(provider.outbound.length, afterStop, 'opted-out users get no marketing/order replies');

    await sendText(waId, 'START');
    await waitForMessage(waId, index, /shuru ho gayi|opt back in/i, 'opt-in confirmation');
    assert.equal(await db.isOptedOut(waId), false);

    await sendText(waId, 'HELP');
    await waitForMessage(waId, index, /Commands:/i, 'help command');
    await sendText(waId, 'PRINT unknown-shop');
    await waitForMessage(waId, index, /was not found/i, 'unknown shop');
  });

  it('restores state from the database for a new manager instance', async () => {
    const waId = '919000000303';
    const index = await setupSession(waId);
    const mediaId = `media-restore-${Date.now()}`;
    provider.registerMockMedia(mediaId, pdf, 'application/pdf', 'assignment.pdf');
    await sendDoc(waId, mediaId);
    await waitForMessage(waId, index, /select colour mode/i, 'colour prompt');
    await sendButton(waId, 'color_bw', 'All B&W');
    await waitForMessage(waId, index, /select sides/i, 'sides prompt');

    // Simulate a restart: a brand-new manager has no in-memory session.
    const conversationModule = await import('../dist/whatsapp/conversation.js');
    const fresh = new conversationModule.ConversationManager();
    await fresh.handleInbound({
      from: waId,
      messageId: `wamid.restart.${Date.now()}`,
      type: 'interactive',
      interactiveReply: { id: 'sides_duplex', title: 'Back-to-Back' }
    });
    await waitForMessage(waId, index, /select number of copies/i, 'copies after restart');
    assert.equal((await db.getActiveWaSession(waId)).context.step, 'copies');
    await sendText(waId, 'CANCEL');
  });

  it('expires an abandoned session and its unpaid order', async () => {
    const waId = '919000000304';
    const index = await setupSession(waId);
    const mediaId = `media-expiry-${Date.now()}`;
    provider.registerMockMedia(mediaId, pdf, 'application/pdf', 'assignment.pdf');
    await sendDoc(waId, mediaId);
    await waitForMessage(waId, index, /select colour mode/i, 'configure before expiry');

    const session = await db.getActiveWaSession(waId);
    await db.saveWaSession({
      ...session,
      expiresAt: new Date(Date.now() - 60_000).toISOString()
    });
    const { reconciliationCron } = await import('../dist/reconciliation.js');
    const result = await reconciliationCron.runReconciliation(new Date());
    assert.ok(result.expiredSessions >= 1);
    assert.equal(await db.getActiveWaSession(waId), undefined);
    if (session.orderId) {
      assert.equal((await db.getOrderById(session.orderId)).status, 'expired');
    }
  });
});

describe('B15 cross-shop isolation', () => {
  it('will not move a customer with an open order to another shop', async () => {
    const unique = crypto.randomBytes(3).toString('hex');
    const user2 = await db.createUser({
      phone: `9${unique.replace(/\D/g, '').padEnd(9, '2').slice(0, 9)}`,
      name: 'WhatsApp Second Owner',
      role: 'owner'
    });
    const shop2 = await db.createShop({
      slug: `wa-second-${unique}`,
      name: 'Second WhatsApp Shop',
      ownerId: user2.id,
      settings: { isOpen: true }
    });
    const token = 'second_agent_token';
    const agent2Record = await db.createAgent({
      shopId: shop2.id,
      name: 'Second Shop Agent',
      tokenHash: crypto
        .createHash('sha256')
        .update(token + (process.env.AGENT_TOKEN_PEPPER || 'dev_agent_pepper'))
        .digest('hex'),
      pairingCode: null,
      pairingCodeExpiresAt: null
    });

    agent2 = new FakeAgent(wsUrl, { agentId: agent2Record.id, token });
    await agent2.connect([
      {
        systemName: 'PDF',
        displayName: 'Second virtual printer',
        color: true,
        duplex: true,
        papers: ['A4']
      }
    ]);
    await waitFor(() => gateway.isShopAgentOnline(shop2.id), 'second agent online');

    const waId = '919000000401';
    const index = await setupSession(waId);
    const mediaId = `media-cross-${Date.now()}`;
    provider.registerMockMedia(mediaId, pdf, 'application/pdf', 'assignment.pdf');
    await sendDoc(waId, mediaId);
    await waitForMessage(waId, index, /select colour mode/i, 'draft at shop A');

    await sendText(waId, `PRINT ${shop2.slug}`);
    const messages = await waitForMessage(
      waId,
      index,
      /already have an order at another shop/i,
      'cross-shop block'
    );
    assert.match(bodyText(messages), /CANCEL first/i);
    const session = await db.getActiveWaSession(waId);
    assert.equal(session.shopId, 'shop-campus-xerox');
    await sendText(waId, 'CANCEL');
  });
});

describe('B8 notifications for web orders', () => {
  it('notifies a consenting web customer and sends nothing without consent', async () => {
    const consentPhone = '9811111111';
    const upload = await uploadFile(baseUrl, pdf, 'web-notify.pdf');
    assert.equal(upload.status, 200);
    const created = await createWebOrder(baseUrl, upload.data.fileId, {}, {
      phone: consentPhone,
      consent: true
    });
    assert.equal(created.status, 200);
    const pay = await fetch(
      `${baseUrl}/v1/orders/${created.data.order.id}/fake-pay?token=${encodeURIComponent(created.data.publicToken)}`,
      { method: 'POST' }
    );
    assert.equal(pay.status, 200);
    const order = await waitFor(
      async () => {
        const fresh = await db.getOrderById(created.data.order.id);
        return fresh.status === 'completed' ? fresh : false;
      },
      'consented web order completion'
    );
    assert.equal(order.customerPhone, consentPhone);
    const toWaId = `91${consentPhone}`;
    const messages = messagesFor(toWaId);
    assert.ok(messages.some((m) => m.templateName === 'order_paid_receipt'));
    assert.ok(messages.some((m) => m.templateName === 'order_ready_pickup'));

    const noConsentPhone = '9822222222';
    const upload2 = await uploadFile(baseUrl, pdf, 'web-no-consent.pdf');
    const created2 = await createWebOrder(baseUrl, upload2.data.fileId, {}, {
      phone: noConsentPhone,
      consent: false
    });
    assert.equal(created2.status, 200);
    const pay2 = await fetch(
      `${baseUrl}/v1/orders/${created2.data.order.id}/fake-pay?token=${encodeURIComponent(created2.data.publicToken)}`,
      { method: 'POST' }
    );
    assert.equal(pay2.status, 200);
    await waitFor(
      async () => (await db.getOrderById(created2.data.order.id)).status === 'completed',
      'no-consent web order completion'
    );
    const noConsentOrder = await db.getOrderById(created2.data.order.id);
    assert.equal(noConsentOrder.customerPhone, null);
    assert.deepEqual(messagesFor(`91${noConsentPhone}`), []);
  });

  it('still prints when every notification send fails', async () => {
    const phone = '9833333333';
    const upload = await uploadFile(baseUrl, pdf, 'web-notify-fail.pdf');
    const created = await createWebOrder(baseUrl, upload.data.fileId, {}, {
      phone,
      consent: true
    });
    assert.equal(created.status, 200);

    const originalText = provider.sendText.bind(provider);
    const originalTemplate = provider.sendTemplate.bind(provider);
    provider.sendText = async () => {
      throw new Error('simulated Meta outage');
    };
    provider.sendTemplate = async () => {
      throw new Error('simulated Meta outage');
    };

    try {
      const dispatchCount = agent.dispatches.length;
      const pay = await fetch(
        `${baseUrl}/v1/orders/${created.data.order.id}/fake-pay?token=${encodeURIComponent(created.data.publicToken)}`,
        { method: 'POST' }
      );
      assert.equal(pay.status, 200);
      const order = await waitFor(
        async () => {
          const fresh = await db.getOrderById(created.data.order.id);
          return fresh.status === 'completed' ? fresh : false;
        },
        'printing despite notification failure'
      );
      assert.equal(order.status, 'completed');
      assert.ok(agent.dispatches.length > dispatchCount);
    } finally {
      provider.sendText = originalText;
      provider.sendTemplate = originalTemplate;
    }
  });
});

describe('B9 shop-owner WhatsApp commands and alerts', () => {
  it('authenticates owner commands and sends a printer alert template', async () => {
    const ownerWaId = '919876543210';
    const index = provider.outbound.length;

    await sendText(ownerWaId, 'QUEUE');
    await waitForMessage(ownerWaId, index, /Queue is empty|Active queue/i, 'owner queue');

    await sendText(ownerWaId, 'PAUSE');
    await waitForMessage(ownerWaId, index, /paused/i, 'owner pause');
    let shop = await db.getShopById('shop-campus-xerox');
    assert.equal(shop.settings.isOpen, false);

    await sendText(ownerWaId, 'RESUME');
    await waitForMessage(ownerWaId, index, /resumed/i, 'owner resume');
    shop = await db.getShopById('shop-campus-xerox');
    assert.equal(shop.settings.isOpen, true);

    await sendText(ownerWaId, 'TODAY');
    await waitForMessage(ownerWaId, index, /Today at/i, 'owner today');

    // A stranger sending an owner command gets normal customer handling, not
    // the owner queue.
    const strangerIndex = provider.outbound.length;
    await sendText('919000000901', 'QUEUE');
    const strangerMessages = messagesFor('919000000901', strangerIndex);
    assert.doesNotMatch(bodyText(strangerMessages), /Queue is empty|Active queue/i);

    await db.updateShop(shop.id, {
      settings: { ...shop.settings, whatsappNumber: ownerWaId }
    });
    await ownerAlerts.alertPrinterIssue(shop.id, 'PDF', 'offline');
    await waitFor(
      () =>
        provider.outbound
          .slice(index)
          .some((m: any) => m.templateName === 'shop_printer_alert'),
      'owner printer alert template'
    );
  });
});

describe('B11 WhatsApp OTP login', () => {
  it('logs in with the OTP delivered to a registered owner', async () => {
    limiters.otpPhone.reset();
    limiters.otpIp.reset();
    limiters.otpVerifyPhone.reset();
    const index = provider.outbound.length;
    const request = await fetch(`${baseUrl}/v1/auth/otp/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210' })
    });
    assert.equal(request.status, 200);
    const template = provider.outbound
      .slice(index)
      .find((m: any) => m.templateName === 'shop_login_otp');
    assert.ok(template);
    const code = template.params[0];
    assert.match(code, /^\d{6}$/);

    const wrong = await fetch(`${baseUrl}/v1/auth/otp/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210', code: '000000' })
    });
    assert.equal(wrong.status, 401);

    const verified = await fetch(`${baseUrl}/v1/auth/otp/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210', code })
    });
    const body = await readJson(verified);
    assert.equal(verified.status, 200, JSON.stringify(body));
    assert.ok(body.token);

    const cookies = (verified.headers as any).getSetCookie?.() ?? [];
    assert.ok(cookies.some((c: string) => /^chhaap_token=/.test(c) && /HttpOnly/.test(c)));
    assert.ok(cookies.some((c: string) => /^chhaap_refresh=/.test(c) && /Path=\/v1\/auth/.test(c)));

    const me = await fetch(`${baseUrl}/v1/auth/me`, {
      headers: { authorization: `Bearer ${body.token}` }
    });
    assert.equal(me.status, 200);
    assert.equal((await readJson(me)).shop.slug, 'campus-xerox');

    const refreshCookie = cookies.find((c: string) => c.startsWith('chhaap_refresh='));
    const refreshValue = refreshCookie.split(';')[0];
    const refreshed = await fetch(`${baseUrl}/v1/auth/refresh`, {
      method: 'POST',
      headers: { cookie: refreshValue }
    });
    assert.equal(refreshed.status, 200);

    const replay = await fetch(`${baseUrl}/v1/auth/refresh`, {
      method: 'POST',
      headers: { cookie: refreshValue }
    });
    assert.equal(replay.status, 401);
  });

  it('locks out after five wrong attempts and rejects expired codes', async () => {
    limiters.otpPhone.reset();
    limiters.otpIp.reset();
    limiters.otpVerifyPhone.reset();
    const index = provider.outbound.length;
    await fetch(`${baseUrl}/v1/auth/otp/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210' })
    });
    const code = provider.outbound
      .slice(index)
      .find((m: any) => m.templateName === 'shop_login_otp').params[0];

    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/v1/auth/otp/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: '9876543210', code: '111111' })
      });
      assert.equal(res.status, 401);
    }
    const locked = await fetch(`${baseUrl}/v1/auth/otp/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210', code })
    });
    assert.equal(locked.status, 401);
    assert.match((await readJson(locked)).error, /Too many/i);

    // Expiry: use a fresh registered phone and force its only OTP into the past.
    const user = await db.createUser({
      phone: '9876500010',
      name: 'Expiry Owner',
      role: 'owner'
    });
    await db.createOtp('9876500010', '424242', config.otpPepper);
    const records = db.otpCodes.filter((o: any) => o.phone === '9876500010');
    records[records.length - 1].expiresAt = new Date(Date.now() - 60_000).toISOString();
    const expired = await fetch(`${baseUrl}/v1/auth/otp/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '9876500010', code: '424242' })
    });
    assert.equal(expired.status, 401);
    assert.match((await readJson(expired)).error, /No active OTP/i);
    assert.ok(user.id);
  });

  it('rate-limits OTP requests per phone', async () => {
    limiters.otpPhone.reset();
    limiters.otpIp.reset();
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/v1/auth/otp/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: '9876543210' })
      });
      assert.equal(res.status, 200, `request ${i + 1}`);
    }
    const blocked = await fetch(`${baseUrl}/v1/auth/otp/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210' })
    });
    assert.equal(blocked.status, 429);
    limiters.otpPhone.reset();
    limiters.otpIp.reset();
  });
});
