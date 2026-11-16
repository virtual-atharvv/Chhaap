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
  readJson,
  uploadFile,
  waitFor
} from './helpers.js';

const dataDir = path.join(os.tmpdir(), `chhaap-api-test-${crypto.randomUUID()}`);
const jwtSecret = 'test_jwt_secret_at_least_32_characters_long';
const webhookSecret = 'test_razorpay_webhook_secret';

process.env.NODE_ENV = 'test';
process.env.DB_MODE = 'memory';
process.env.PAYMENTS_MODE = 'simulated';
process.env.WHATSAPP_MODE = 'mock';
process.env.JWT_SECRET = jwtSecret;
process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;
process.env.CHHAAP_DATA_DIR = dataDir;
process.env.LOG_LEVEL = 'silent';

let app: any;
let baseUrl = '';
let pdf: Buffer;
let db: any;
let config: any;
let limiters: any;
let reconciliationCron: any;
let serverStorage: any;
let agent: FakeAgent | undefined;

async function newOrder(
  settings: Record<string, unknown> = {},
  options: { phone?: string; consent?: boolean; key?: string } = {}
): Promise<{ fileId: string; order: any; token: string; pricing: any }> {
  const upload = await uploadFile(baseUrl, pdf, 'assignment.pdf');
  assert.equal(upload.status, 200, JSON.stringify(upload.data));
  const created = await createWebOrder(baseUrl, upload.data.fileId, settings, options);
  assert.equal(created.status, 200, JSON.stringify(created.data));
  return {
    fileId: upload.data.fileId,
    order: created.data.order,
    token: created.data.publicToken,
    pricing: created.data.pricing
  };
}

function webhookBody(
  payment: { order_id: string; id: string; amount: number; currency?: string },
  event = 'payment.captured',
  createdAt = Math.floor(Date.now() / 1000)
): string {
  return JSON.stringify({
    event,
    created_at: createdAt,
    payload: {
      payment: {
        entity: {
          id: payment.id,
          order_id: payment.order_id,
          amount: payment.amount,
          currency: payment.currency ?? 'INR',
          method: 'upi'
        }
      }
    }
  });
}

async function postRazorpay(
  raw: string,
  options: { eventId?: string; signature?: string } = {}
): Promise<Response> {
  const signature =
    options.signature ?? crypto.createHmac('sha256', webhookSecret).update(raw).digest('hex');
  return fetch(`${baseUrl}/v1/webhooks/razorpay`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-razorpay-signature': signature,
      ...(options.eventId ? { 'x-razorpay-event-id': options.eventId } : {})
    },
    body: raw
  });
}

before(async () => {
  await fs.mkdir(dataDir, { recursive: true });
  pdf = await makeTestPdf(dataDir);

  const serverModule = await import('../dist/server.js');
  const dbModule = await import('@chhaap/db');
  const configModule = await import('../dist/config.js');
  const rateLimitModule = await import('../dist/rate-limit.js');
  const reconModule = await import('../dist/reconciliation.js');
  const storageModule = await import('../dist/storage.js');

  db = dbModule.db;
  config = configModule.loadConfig();
  limiters = rateLimitModule.limiters;
  reconciliationCron = reconModule.reconciliationCron;
  serverStorage = storageModule.storage;

  app = await serverModule.buildServer();
  baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  process.env.PUBLIC_BASE_URL = baseUrl;
});

after(async () => {
  await agent?.close();
  await app?.close();
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('Health and public shop entry', () => {
  it('serves health and readiness probes', async () => {
    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.equal((await readJson(health)).status, 'ok');

    const ready = await fetch(`${baseUrl}/readyz`);
    assert.equal(ready.status, 200);
    assert.equal((await readJson(ready)).database, 'connected');
  });

  it('returns the public shop view including printer capability', async () => {
    const res = await fetch(`${baseUrl}/v1/shops/campus-xerox`);
    assert.equal(res.status, 200);
    const data = await readJson(res);
    assert.equal(data.shop.slug, 'campus-xerox');
    assert.equal(data.shop.printerOnline, false, 'no simulated agent connected yet');
    assert.ok(Array.isArray(data.rates));
  });
});

describe('A2 tenant isolation and shop auth', () => {
  let shop2Id: string;
  let token2: string;
  let order1: Awaited<ReturnType<typeof newOrder>>;

  before(async () => {
    const user2 = await db.createUser({
      phone: '9123456780',
      name: 'Second Owner',
      role: 'owner'
    });
    const shop2 = await db.createShop({
      slug: `second-shop-${crypto.randomBytes(3).toString('hex')}`,
      name: 'Second Shop',
      ownerId: user2.id
    });
    shop2Id = shop2.id;
    const { signJwt } = await import('../dist/auth.js');
    token2 = signJwt({ userId: user2.id, role: 'owner', shopId: shop2.id }, jwtSecret);
    agent = new FakeAgent(`${baseUrl.replace(/^http/, 'ws')}/v1/agent/connect`);
    await agent.connect();
    // Keep jobs queued: these tests verify server-side state transitions, not
    // the agent's print completion path.
    agent.autoRespond = false;
    await waitFor(async () => {
      const res = await fetch(`${baseUrl}/v1/shops/campus-xerox`);
      return (await readJson(res)).shop.printerOnline;
    }, 'agent online');
    order1 = await newOrder();
  });

  it('rejects unauthenticated shop routes', async () => {
    for (const route of ['/v1/shop/me', '/v1/shop/queue', '/v1/shop/settings', '/v1/shop/printers']) {
      const res = await fetch(baseUrl + route);
      assert.equal(res.status, 401, route);
    }
  });

  it('scopes every shop route to the token shop, never a URL/body shop id', async () => {
    const me = await fetch(`${baseUrl}/v1/shop/me`, {
      headers: { authorization: `Bearer ${token2}` }
    });
    assert.equal(me.status, 200);
    assert.equal((await readJson(me)).shop.id, shop2Id);

    const queue = await fetch(`${baseUrl}/v1/shop/queue`, {
      headers: { authorization: `Bearer ${token2}` }
    });
    assert.equal(queue.status, 200);
    assert.deepEqual((await readJson(queue)).orders, []);

    const crossOrder = await fetch(`${baseUrl}/v1/shop/orders/${order1.order.id}`, {
      headers: { authorization: `Bearer ${token2}` }
    });
    assert.equal(crossOrder.status, 404);

    const crossCancel = await fetch(`${baseUrl}/v1/shop/orders/${order1.order.id}/cancel`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token2}` }
    });
    assert.equal(crossCancel.status, 404);

    const crossReprint = await fetch(`${baseUrl}/v1/shop/orders/${order1.order.id}/reprint`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token2}` }
    });
    assert.equal(crossReprint.status, 404);

    const crossAgent = await fetch(
      `${baseUrl}/v1/shop/agents/agent-campus-1/rotate-token`,
      { method: 'POST', headers: { authorization: `Bearer ${token2}` } }
    );
    assert.equal(crossAgent.status, 404);
  });

  it('accepts a valid owner JWT and returns only that shop', async () => {
    const { signJwt } = await import('../dist/auth.js');
    const token = signJwt(
      { userId: 'user-owner-1', role: 'owner', shopId: 'shop-campus-xerox' },
      jwtSecret
    );
    const res = await fetch(`${baseUrl}/v1/shop/queue`, {
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(res.status, 200);
    const data = await readJson(res);
    assert.equal(data.shop.id, 'shop-campus-xerox');
  });
});

describe('A5/A7 upload, pricing and public order token', () => {
  it('uploads a real PDF, analyses it server-side and prices the order', async () => {
    const upload = await uploadFile(baseUrl, pdf, '../../assignment.pdf');
    assert.equal(upload.status, 200, JSON.stringify(upload.data));
    assert.equal(upload.data.pageCount, 2);
    assert.equal(upload.data.originalName, 'assignment.pdf');
    assert.equal(upload.data.perPageClassification.length, 2);

    const created = await createWebOrder(baseUrl, upload.data.fileId, {
      copies: 2,
      colorMode: 'bw',
      sides: 'single'
    });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    assert.equal(created.data.pricing.subtotalPaise, 800);
    assert.equal(created.data.pricing.feePaise, 100);
    assert.equal(created.data.pricing.totalPaise, 900);
    assert.ok(created.data.publicToken.length >= 32);

    const file = await db.getFileById(upload.data.fileId);
    assert.ok(file.storageKey);
    assert.equal(file.storageKey.includes('..'), false);
  });

  it('rejects spoofed magic bytes, encrypted PDFs and unsupported extensions', async () => {
    const spoof = await uploadFile(
      baseUrl,
      Buffer.from('this is not a pdf at all'),
      'spoof.pdf',
      'application/pdf'
    );
    assert.equal(spoof.status, 400);
    assert.match(spoof.data.error, /Unsupported|empty|format/i);

    const encrypted = await uploadFile(
      baseUrl,
      Buffer.from('%PDF-1.7\n1 0 obj << /Encrypt 2 0 R >> endobj\n%%EOF'),
      'locked.pdf'
    );
    assert.equal(encrypted.status, 400);
    assert.match(encrypted.data.error, /Password-protected/i);

    const archive = await uploadFile(
      baseUrl,
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]),
      'payload.zip',
      'application/zip'
    );
    assert.equal(archive.status, 400);
    assert.match(archive.data.error, /Unsupported|ZIP/i);
  });

  it('requires the public token for status, SSE and checkout', async () => {
    const { order, token } = await newOrder();

    for (const query of ['', `?token=${encodeURIComponent(order.token)}`, '?token=wrong']) {
      const res = await fetch(`${baseUrl}/v1/orders/${order.id}${query}`);
      assert.equal(res.status, 403, `query ${query}`);
    }

    const ok = await fetch(`${baseUrl}/v1/orders/${order.id}?token=${encodeURIComponent(token)}`);
    assert.equal(ok.status, 200);
    assert.equal((await readJson(ok)).order.id, order.id);

    const checkoutNoToken = await fetch(`${baseUrl}/v1/orders/${order.id}/checkout`, {
      method: 'POST'
    });
    assert.equal(checkoutNoToken.status, 403);

    const controller = new AbortController();
    const stream = await fetch(
      `${baseUrl}/v1/orders/${order.id}/stream?token=${encodeURIComponent(token)}`,
      { signal: controller.signal }
    );
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get('content-type') ?? '', /text\/event-stream/);
    const reader = stream.body!.getReader();
    const first = await reader.read();
    assert.match(Buffer.from(first.value ?? []).toString('utf-8'), /event: status/);
    controller.abort();
  });

  it('rejects changing settings after payment and re-prices before payment', async () => {
    const { order, token } = await newOrder();
    const detail = await readJson(
      await fetch(`${baseUrl}/v1/orders/${order.id}?token=${encodeURIComponent(token)}`)
    );
    const itemId = detail.items[0].id;

    const patched = await fetch(`${baseUrl}/v1/orders/${order.id}/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token,
        settings: { copies: 3, colorMode: 'color', sides: 'duplex' }
      })
    });
    assert.equal(patched.status, 200);
    const patchedData = await readJson(patched);
    assert.equal(patchedData.pricing.subtotalPaise, 2 * 3 * 800);
    assert.equal(patchedData.pricing.totalPaise, 4900);

    const checkout = await fetch(
      `${baseUrl}/v1/orders/${order.id}/checkout?token=${encodeURIComponent(token)}`,
      { method: 'POST' }
    );
    assert.equal(checkout.status, 200);

    const blocked = await fetch(`${baseUrl}/v1/orders/${order.id}/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, settings: { copies: 1 } })
    });
    assert.equal(blocked.status, 400);
  });
});

describe('A4 persistent file deletion', () => {
  it('deletes bytes and marks the DB row after a simulated restart', async () => {
    // Stop the process-wide sweeper so this test observes its own manual sweep.
    serverStorage.stopSweeper();
    const { StorageService } = await import('../dist/storage.js');
    const dir = path.join(dataDir, `sweep-${crypto.randomUUID()}`);
    const storage1 = new StorageService(dir);
    await storage1.init();

    const storageKey = 'expired.pdf';
    await fs.writeFile(path.join(storage1.getUploadsPath(), storageKey), '%PDF-1.4 expired');
    const file = await db.addFile({
      orderId: null,
      storageKey,
      originalName: 'expired.pdf',
      mime: 'application/pdf',
      sizeBytes: 14,
      sha256: 'expired-hash',
      scanStatus: 'clean',
      convertedPdfKey: null,
      previewKeys: [],
      pageCount: 1,
      classification: [{ pageNumber: 1, isColor: false }],
      deleteAfter: new Date(Date.now() - 60_000).toISOString(),
      deletedAt: null
    });

    // New process / new service instance, same database deadline.
    const storage2 = new StorageService(dir);
    await storage2.init();
    const deleted = await storage2.sweepExpiredFiles();
    assert.equal(deleted, 1);

    const after = await db.getFileById(file.id);
    assert.ok(after.deletedAt);
    await assert.rejects(fs.access(path.join(storage2.getUploadsPath(), storageKey)));
  });
});

describe('A6 payment webhook hardening', () => {
  let order: any;
  let token: string;
  let payment: any;

  before(async () => {
    const created = await newOrder();
    order = created.order;
    token = created.token;
    const checkout = await fetch(
      `${baseUrl}/v1/orders/${order.id}/checkout?token=${encodeURIComponent(token)}`,
      { method: 'POST' }
    );
    assert.equal(checkout.status, 200);
    payment = await db.getPaymentByOrderId(order.id);
    assert.ok(payment);
  });

  it('rejects missing/tampered signatures and stale events', async () => {
    const raw = webhookBody({
      order_id: payment.razorpayOrderId,
      id: 'pay_bad_signature',
      amount: order.totalPaise
    });

    const missing = await fetch(`${baseUrl}/v1/webhooks/razorpay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw
    });
    assert.equal(missing.status, 400);

    const tampered = await postRazorpay(raw, { signature: 'deadbeef' });
    assert.equal(tampered.status, 400);
    assert.equal((await db.getOrderById(order.id)).status, 'awaiting_payment');

    const stale = await postRazorpay(
      webhookBody(
        { order_id: payment.razorpayOrderId, id: 'pay_stale', amount: order.totalPaise },
        'payment.captured',
        Math.floor(Date.now() / 1000) - 3600
      )
    );
    assert.equal(stale.status, 400);
  });

  it('rejects amount and currency mismatches without changing order state', async () => {
    const wrongAmount = await postRazorpay(
      webhookBody({
        order_id: payment.razorpayOrderId,
        id: 'pay_wrong_amount',
        amount: order.totalPaise + 1
      })
    );
    assert.equal(wrongAmount.status, 400);

    const wrongCurrency = await postRazorpay(
      webhookBody({
        order_id: payment.razorpayOrderId,
        id: 'pay_wrong_currency',
        amount: order.totalPaise,
        currency: 'USD'
      })
    );
    assert.equal(wrongCurrency.status, 400);
    assert.equal((await db.getOrderById(order.id)).status, 'awaiting_payment');
  });

  it('verifies the payment once, queues exactly one job and dedupes replay', async () => {
    const raw = webhookBody({
      order_id: payment.razorpayOrderId,
      id: 'pay_captured_1',
      amount: order.totalPaise
    });

    const first = await postRazorpay(raw, { eventId: `evt-${order.id}` });
    assert.equal(first.status, 200);

    const fresh = await db.getOrderById(order.id);
    assert.equal(fresh.status, 'queued');
    assert.ok(fresh.paidAt);

    const decoded = JSON.parse(raw);
    const stored = await db.getPaymentByRazorpayOrderId(decoded.payload.payment.entity.order_id);
    assert.equal(stored.status, 'captured');
    assert.equal(stored.signatureVerified, true);

    const jobs = (await db.getOrderItemsByOrderId(order.id)).flatMap((item: any) =>
      db.getPrintJobsByOrderItemId(item.id)
    );
    const resolvedJobs = await Promise.all(jobs);
    assert.equal(resolvedJobs.flat().length, 1);

    const replay = await postRazorpay(raw, { eventId: `evt-${order.id}` });
    assert.equal(replay.status, 200);
    assert.equal((await readJson(replay)).status, 'already_processed');
    assert.equal((await db.getOrderById(order.id)).status, 'queued');
    assert.equal((await Promise.all(
      (await db.getOrderItemsByOrderId(order.id)).map((item: any) =>
        db.getPrintJobsByOrderItemId(item.id)
      )
    )).flat().length, 1);
    assert.equal(db.webhookEvents.size >= 1, true);
  });
});

describe('A9/A8 reconciliation', () => {
  it('retries a vanished agent twice then fails and refunds', async () => {
    const { order, token } = await newOrder();
    const checkout = await fetch(
      `${baseUrl}/v1/orders/${order.id}/checkout?token=${encodeURIComponent(token)}`,
      { method: 'POST' }
    );
    assert.equal(checkout.status, 200);
    const simulated = await fetch(
      `${baseUrl}/v1/orders/${order.id}/fake-pay?token=${encodeURIComponent(token)}`,
      { method: 'POST' }
    );
    assert.equal(simulated.status, 200, JSON.stringify(await readJson(simulated).catch(() => ({}))));

    const items = await db.getOrderItemsByOrderId(order.id);
    const jobs = await db.getPrintJobsByOrderItemId(items[0].id);
    const job = jobs[0];
    assert.ok(job);

    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    for (let attempt = 1; attempt <= 3; attempt++) {
      await db.updatePrintJob(job.id, { status: 'dispatched', dispatchedAt: old });
      await reconciliationCron.runReconciliation(new Date());
      const current = await db.getPrintJobById(job.id);
      if (attempt < 3) {
        // The reconciler requeues the job; an online agent may pick it up
        // again before this assertion runs.
        assert.equal(current.attempts, attempt);
        assert.ok(['pending', 'dispatched'].includes(current.status), current.status);
      } else {
        assert.equal(current.status, 'failed');
        assert.equal((await db.getOrderById(order.id)).status, 'refunded');
      }
    }
  });

  it('expires unpaid orders after the TTL', async () => {
    const { order } = await newOrder();
    assert.equal((await db.getOrderById(order.id)).status, 'draft');
    // Draft orders are not picked up by the expired-payment query; move to
    // awaiting_payment with an old timestamp by direct DB manipulation.
    await db.transitionOrderStatus(order.id, 'awaiting_payment');
    await db.updateOrderTotals(order.id, {
      subtotalPaise: 200,
      feePaise: 100,
      gstPaise: 0,
      totalPaise: 500
    });
    const stored = await db.getOrderById(order.id);
    stored.createdAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const result = await reconciliationCron.runReconciliation(new Date());
    assert.ok(result.expiredOrders >= 1);
    assert.equal((await db.getOrderById(order.id)).status, 'expired');
  });
});

describe('A10 rate limiting and A13 probes', () => {
  it('returns 429 after the upload limiter window is exhausted', async () => {
    limiters.uploadIp.reset();
    for (let i = 0; i < 20; i++) {
      const res = await fetch(`${baseUrl}/v1/uploads`, { method: 'POST' });
      assert.notEqual(res.status, 429, `request ${i + 1}`);
    }
    const blocked = await fetch(`${baseUrl}/v1/uploads`, { method: 'POST' });
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('retry-after'));
    limiters.uploadIp.reset();
  });
});

describe('A14 money invariants through the API', () => {
  it('keeps quote, order and simulated payment amount identical', async () => {
    const { order, token, pricing } = await newOrder({ copies: 2, colorMode: 'smart' });
    assert.equal(order.totalPaise, pricing.totalPaise);

    const pay = await fetch(
      `${baseUrl}/v1/orders/${order.id}/fake-pay?token=${encodeURIComponent(token)}`,
      { method: 'POST' }
    );
    assert.equal(pay.status, 200);
    const captured = await db.getPaymentByOrderId(order.id);
    assert.equal(captured.amountPaise, pricing.totalPaise);
    assert.equal(captured.status, 'captured');
    const fresh = await db.getOrderById(order.id);
    assert.equal(fresh.status, 'queued');
    assert.equal(fresh.totalPaise, pricing.totalPaise);
  });
});
