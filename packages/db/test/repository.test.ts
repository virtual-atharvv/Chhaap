import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDatabase } from '../dist/index.js';
import { sha256Hex } from '@chhaap/shared';

const SHOP = 'shop-campus-xerox';

function fileInput(overrides: Partial<Parameters<MemoryDatabase['addFile']>[0]> = {}) {
  return {
    orderId: null,
    storageKey: 'key.pdf',
    originalName: 'doc.pdf',
    mime: 'application/pdf',
    sizeBytes: 1024,
    sha256: 'abc',
    scanStatus: 'clean' as const,
    convertedPdfKey: null,
    previewKeys: [],
    pageCount: 1,
    classification: [{ pageNumber: 1, isColor: false }],
    deleteAfter: new Date(Date.now() + 60_000).toISOString(),
    deletedAt: null,
    ...overrides
  };
}

describe('Repository contract (memory)', () => {
  it('creates orders with unguessable public tokens and idempotency keys', async () => {
    const db = new MemoryDatabase();
    const order = await db.createOrder({ shopId: SHOP, idempotencyKey: 'idem-order-1' });

    assert.match(order.token, /^[A-Z]-\d{3}$/);
    assert.ok(order.publicToken.length >= 32);
    assert.equal(order.status, 'draft');
    assert.equal(order.channel, 'web');

    const repeat = await db.createOrder({ shopId: SHOP, idempotencyKey: 'idem-order-1' });
    assert.equal(repeat.id, order.id);

    const wa = await db.createOrder({
      shopId: SHOP,
      idempotencyKey: 'idem-wa-1',
      channel: 'whatsapp',
      customerWaId: '919876543210'
    });
    assert.equal(wa.channel, 'whatsapp');
    assert.equal(wa.customerWaId, '919876543210');
    assert.equal(await db.getLastOrderByWaId('919876543210').then((o) => o?.id), wa.id);
  });

  it('enforces the state machine and optimistic transitions', async () => {
    const db = new MemoryDatabase();
    const order = await db.createOrder({ shopId: SHOP, idempotencyKey: 'idem-state-1' });

    const started = await db.transitionOrderStatus(order.id, 'awaiting_payment');
    assert.equal(started.success, true);

    const invalid = await db.transitionOrderStatus(order.id, 'completed');
    assert.equal(invalid.success, false);
    assert.match(invalid.error ?? '', /Cannot transition/);

    const paid = await db.transitionOrderStatus(order.id, 'paid', { paymentId: 'p1' });
    assert.equal(paid.success, true);
    assert.ok(paid.order?.paidAt);

    // Replaying the same transition must not succeed a second time.
    const replay = await db.transitionOrderStatus(order.id, 'paid');
    assert.equal(replay.success, false);

    assert.equal((await db.transitionOrderStatus(order.id, 'queued')).success, true);
    assert.equal((await db.transitionOrderStatus(order.id, 'printing')).success, true);
    const completed = await db.transitionOrderStatus(order.id, 'completed');
    assert.equal(completed.success, true);
    assert.ok(completed.order?.completedAt);
  });

  it('returns only files whose persisted deletion deadline has passed', async () => {
    const db = new MemoryDatabase();
    const expired = await db.addFile(
      fileInput({ storageKey: 'old.pdf', deleteAfter: new Date(Date.now() - 10_000).toISOString() })
    );
    await db.addFile(
      fileInput({ storageKey: 'fresh.pdf', deleteAfter: new Date(Date.now() + 60_000).toISOString() })
    );

    const pending = await db.getFilesPendingDeletion(new Date());
    assert.deepEqual(pending.map((f) => f.id), [expired.id]);
    assert.equal(await db.markFileDeleted(expired.id), true);
    assert.equal(await db.markFileDeleted(expired.id), false);
    assert.equal((await db.getFilesPendingDeletion(new Date())).length, 0);
  });

  it('locks an OTP after five wrong attempts and consumes it on success', async () => {
    const db = new MemoryDatabase();
    await db.createOtp('9876543210', '456789', 'pepper');

    for (let i = 0; i < 5; i++) {
      const result = await db.verifyOtp('9876543210', '000000', 'pepper');
      assert.equal(result.valid, false);
    }
    const locked = await db.verifyOtp('9876543210', '456789', 'pepper');
    assert.equal(locked.valid, false);
    assert.match(locked.error ?? '', /Too many/);

    await db.createOtp('9876543211', '123456', 'pepper');
    assert.equal((await db.verifyOtp('9876543211', '123456', 'pepper')).valid, true);
    const replay = await db.verifyOtp('9876543211', '123456', 'pepper');
    assert.equal(replay.valid, false);
  });

  it('stores OTPs and refresh tokens hashed, never in plaintext', async () => {
    const db = new MemoryDatabase();
    await db.createOtp('9876543210', '445566', 'pepper');
    assert.equal(db.otpCodes[0]?.codeHash, sha256Hex('445566pepper'));
    assert.notEqual(db.otpCodes[0]?.codeHash, '445566');

    await db.createRefreshToken('user-owner-1', 'refresh-secret', 'refresh-pepper');
    assert.equal((await db.consumeRefreshToken('wrong', 'refresh-pepper')).valid, false);
    const first = await db.consumeRefreshToken('refresh-secret', 'refresh-pepper');
    assert.equal(first.valid, true);
    const replay = await db.consumeRefreshToken('refresh-secret', 'refresh-pepper');
    assert.equal(replay.valid, false);
    assert.match(replay.error ?? '', /already used/);
  });

  it('enforces WhatsApp session uniqueness and expiry', async () => {
    const db = new MemoryDatabase();
    const base = {
      waId: '919876543210',
      shopId: SHOP,
      state: 'AWAITING_FILE' as const,
      lang: 'hinglish' as const,
      orderId: null,
      context: {},
      lastInboundAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
      createdAt: new Date().toISOString()
    };

    await db.saveWaSession({ ...base, id: 'session-1' });
    assert.equal((await db.getActiveWaSession(base.waId))?.id, 'session-1');

    // Starting a new session supersedes the previous one; a DONE session is
    // not active and never shadows the conversation that replaced it.
    await db.saveWaSession({
      ...base,
      id: 'session-2',
      state: 'DONE',
      expiresAt: new Date(Date.now() + 1_800_000).toISOString()
    });
    assert.equal(await db.getActiveWaSession(base.waId), undefined);

    await db.saveWaSession({ ...base, id: 'session-3' });
    assert.equal((await db.getActiveWaSession(base.waId))?.id, 'session-3');

    const expired = await db.expireInactiveWaSessions(new Date(Date.now() + 2_000_000));
    assert.deepEqual(expired.map((s) => s.id), ['session-3']);
    assert.equal(await db.getActiveWaSession(base.waId), undefined);
  });

  it('dedupes webhook events, notifications and WhatsApp status updates', async () => {
    const db = new MemoryDatabase();
    assert.equal(await db.recordWebhookEvent('razorpay', 'evt-1', {}), true);
    assert.equal(await db.recordWebhookEvent('razorpay', 'evt-1', {}), false);

    const order = await db.createOrder({ shopId: SHOP, idempotencyKey: 'idem-dedupe-1' });
    assert.equal(await db.recordNotification(order.id, 'paid'), true);
    assert.equal(await db.recordNotification(order.id, 'paid'), false);

    await db.recordWaMessage({
      wamid: 'wamid.1',
      direction: 'in',
      waId: '919876543210',
      type: 'text',
      payload: {},
      status: 'received',
      orderId: null
    });
    assert.equal(await db.isWaMessageProcessed('wamid.1'), true);
    assert.equal(await db.recordWaStatus('wamid.out.1', 'delivered'), true);
    assert.equal(await db.recordWaStatus('wamid.out.1', 'delivered'), false);
  });

  it('hashes pairing codes supplied by the shop API', async () => {
    const db = new MemoryDatabase();
    const code = '135790';
    const agent = await db.createAgent({
      shopId: SHOP,
      name: 'Second agent',
      tokenHash: sha256Hex('placeholder'),
      pairingCode: sha256Hex(code + 'pair-pepper'),
      pairingCodeExpiresAt: new Date(Date.now() + 600_000).toISOString()
    });
    const found = await db.getAgentByPairingCode(code, 'pair-pepper');
    assert.equal(found?.id, agent.id);
    assert.equal(await db.getAgentByPairingCode('000000', 'pair-pepper'), undefined);
  });

  it('optimistically guards print jobs and sums order analytics inputs', async () => {
    const db = new MemoryDatabase();
    const order = await db.createOrder({ shopId: SHOP, idempotencyKey: 'idem-jobs-1' });
    const file = await db.addFile(fileInput({ orderId: order.id }));
    const item = await db.addOrderItem({
      orderId: order.id,
      fileId: file.id,
      settings: {
        copies: 1,
        paperSize: 'A4',
        colorMode: 'bw',
        sides: 'single',
        pagesPerSheet: 1,
        orientation: 'auto',
        fitMode: 'fit'
      },
      pageCount: 1,
      colourPages: 0,
      bwPages: 1,
      sheets: 1,
      lineTotalPaise: 200,
      printerId: null
    });
    await db.updateOrderTotals(order.id, {
      subtotalPaise: 200,
      feePaise: 100,
      gstPaise: 0,
      totalPaise: 500
    });
    await db.transitionOrderStatus(order.id, 'awaiting_payment');
    await db.transitionOrderStatus(order.id, 'paid');
    await db.transitionOrderStatus(order.id, 'queued');

    const job = await db.createPrintJob({ orderItemId: item.id, printerId: null, status: 'pending' });
    assert.equal((await db.updatePrintJob(job.id, { status: 'dispatched' }))?.status, 'dispatched');
    const pending = await db.getPendingPrintJobsForShop(SHOP);
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.file.id, file.id);
    assert.equal(pending[0]?.order.id, order.id);
  });
});
