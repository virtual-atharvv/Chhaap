import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PostgresDatabase } from '../dist/index.js';

const connectionString = process.env.TEST_DATABASE_URL;
const here = path.dirname(fileURLToPath(import.meta.url));

describe(
  'Repository contract (Postgres)',
  { skip: connectionString ? false : 'Set TEST_DATABASE_URL to run Postgres contract tests' },
  () => {
    let db: PostgresDatabase;
    let shopId: string;
    const unique = crypto.randomBytes(6).toString('hex');

    before(async () => {
      const schema = await fs.readFile(path.join(here, '..', 'src', 'schema.sql'), 'utf-8');
      const client = new pg.Client({ connectionString });
      await client.connect();
      await client.query(schema);
      await client.end();

      db = new PostgresDatabase(connectionString!);
      const user = await db.createUser({
        phone: `9${unique.replace(/\D/g, '').padEnd(9, '1').slice(0, 9)}`,
        name: 'Postgres Contract Owner',
        role: 'owner'
      });
      const shop = await db.createShop({
        slug: `contract-${unique}`,
        name: 'Contract Shop',
        ownerId: user.id,
        city: 'Test City'
      });
      shopId = shop.id;
    });

    after(async () => {
      await db?.close();
    });

    it('persists an order and optimistically transitions it', async () => {
      const order = await db.createOrder({ shopId, idempotencyKey: `pg-${unique}` });
      assert.equal(order.status, 'draft');
      assert.ok(order.publicToken.length >= 32);

      const started = await db.transitionOrderStatus(order.id, 'awaiting_payment');
      assert.equal(started.success, true);
      const paid = await db.transitionOrderStatus(order.id, 'paid', { paymentId: 'pg-payment' });
      assert.equal(paid.success, true);
      assert.equal((await db.transitionOrderStatus(order.id, 'queued')).success, true);
      assert.equal((await db.transitionOrderStatus(order.id, 'queued')).success, false);

      const reread = await db.getOrderById(order.id);
      assert.equal(reread?.status, 'queued');
      assert.ok(reread?.paidAt);
    });

    it('persists deletion deadlines and webhook dedupe in unique constraints', async () => {
      const file = await db.addFile({
        orderId: null,
        storageKey: `pg-${unique}.pdf`,
        originalName: 'pg.pdf',
        mime: 'application/pdf',
        sizeBytes: 100,
        sha256: 'pg-hash',
        scanStatus: 'clean',
        convertedPdfKey: null,
        previewKeys: [],
        pageCount: 1,
        classification: [{ pageNumber: 1, isColor: false }],
        deleteAfter: new Date(Date.now() - 1000).toISOString(),
        deletedAt: null
      });
      const pending = await db.getFilesPendingDeletion(new Date());
      assert.ok(pending.some((f) => f.id === file.id));
      assert.equal(await db.markFileDeleted(file.id), true);

      assert.equal(await db.recordWebhookEvent('razorpay', `evt-${unique}`, {}), true);
      assert.equal(await db.recordWebhookEvent('razorpay', `evt-${unique}`, {}), false);
    });

    it('persists WhatsApp sessions and notification dedupe', async () => {
      const waId = `91${unique}`;
      await db.saveWaSession({
        id: crypto.randomUUID(),
        waId,
        shopId,
        state: 'AWAITING_FILE',
        lang: 'hinglish',
        orderId: null,
        context: { probe: true },
        lastInboundAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        createdAt: new Date().toISOString()
      });
      assert.equal((await db.getActiveWaSession(waId))?.context.probe, true);

      const order = await db.createOrder({ shopId, idempotencyKey: `pg-notify-${unique}` });
      assert.equal(await db.recordNotification(order.id, 'paid'), true);
      assert.equal(await db.recordNotification(order.id, 'paid'), false);
    });
  }
);
