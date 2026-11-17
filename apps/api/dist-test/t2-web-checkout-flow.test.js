import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeAgent, createWebOrder, makeTestPdf, readJson, uploadFile, waitFor } from './helpers.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const customerHtmlPath = path.resolve(__dirname, '../../web/public/customer.html');
const dataDir = path.join(os.tmpdir(), `chhaap-t2-test-${crypto.randomUUID()}`);
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
let app;
let baseUrl = '';
let pdf;
let agent;
let sharedModule;
before(async () => {
    await fs.mkdir(dataDir, { recursive: true });
    pdf = await makeTestPdf(dataDir);
    sharedModule = await import('@chhaap/shared');
    const serverModule = await import('../dist/server.js');
    app = await serverModule.buildServer();
    baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
    process.env.PUBLIC_BASE_URL = baseUrl;
    // Connect virtual agent so printer is online
    agent = new FakeAgent(`${baseUrl.replace('http', 'ws')}/v1/agent/connect`, {
        agentId: 'agent-campus-1',
        token: 'test_agent_secret_token_123'
    });
    await agent.connect();
    await waitFor(() => agent.ack, 'agent ack');
});
after(async () => {
    await agent?.close();
    await app?.close();
    await fs.rm(dataDir, { recursive: true, force: true });
});
describe('T2 — Web checkout and payment contract', () => {
    it('customer.html contains no reference to shortUrl', async () => {
        const customerHtml = await fs.readFile(customerHtmlPath, 'utf8');
        assert.doesNotMatch(customerHtml, /shortUrl/, 'customer.html must not reference nonexistent shortUrl');
    });
    it('checkout response satisfies CheckoutResponseSchema in simulated mode', async () => {
        const upload = await uploadFile(baseUrl, pdf, 'contract-test.pdf');
        assert.equal(upload.status, 200);
        const created = await createWebOrder(baseUrl, upload.data.fileId, {
            copies: 1,
            paperSize: 'A4',
            colorMode: 'bw',
            sides: 'single'
        });
        assert.equal(created.status, 200);
        const orderId = created.data.order.id;
        const publicToken = created.data.publicToken;
        const checkoutRes = await fetch(`${baseUrl}/v1/orders/${orderId}/checkout?token=${encodeURIComponent(publicToken)}`, { method: 'POST' });
        assert.equal(checkoutRes.status, 200);
        const checkoutData = await readJson(checkoutRes);
        assert.ok(sharedModule.CheckoutResponseSchema, 'CheckoutResponseSchema must be exported by @chhaap/shared');
        const parsed = sharedModule.CheckoutResponseSchema.safeParse(checkoutData);
        assert.equal(parsed.success, true, `Validation failed: ${JSON.stringify(parsed.error?.issues)}`);
        assert.equal(checkoutData.mode, 'simulated');
        assert.ok(checkoutData.simulatedPayUrl);
    });
    it('checkout response satisfies CheckoutResponseSchema in razorpay mode (unit test)', async () => {
        const dummyRazorpayResponse = {
            mode: 'razorpay',
            orderId: '00000000-0000-0000-0000-000000000001',
            amountPaise: 500,
            currency: 'INR',
            keyId: 'rzp_test_123',
            razorpayOrderId: 'order_rzp_123',
            prefill: { contact: '9876543210' }
        };
        const parsed = sharedModule.CheckoutResponseSchema.safeParse(dummyRazorpayResponse);
        assert.equal(parsed.success, true);
        if (parsed.success) {
            assert.equal(parsed.data.mode, 'razorpay');
            assert.equal(parsed.data.razorpayOrderId, 'order_rzp_123');
        }
    });
    it('end-to-end browser-equivalent simulated checkout reaches completed state', async () => {
        // 1. Upload file
        const upload = await uploadFile(baseUrl, pdf, 'thesis.pdf');
        assert.equal(upload.status, 200);
        const fileId = upload.data.fileId;
        // 2. Create order
        const created = await createWebOrder(baseUrl, fileId, {
            copies: 1,
            paperSize: 'A4',
            colorMode: 'bw',
            sides: 'single'
        });
        assert.equal(created.status, 200);
        const order = created.data.order;
        const token = created.data.publicToken;
        assert.equal(order.status, 'draft');
        // 3. Create checkout
        const checkoutRes = await fetch(`${baseUrl}/v1/orders/${order.id}/checkout?token=${encodeURIComponent(token)}`, { method: 'POST' });
        assert.equal(checkoutRes.status, 200);
        const checkout = await readJson(checkoutRes);
        assert.equal(checkout.mode, 'simulated');
        // 4. Pay via simulatedPayUrl
        const payRes = await fetch(`${baseUrl}${checkout.simulatedPayUrl}`, {
            method: 'POST'
        });
        assert.equal(payRes.status, 200);
        // 5. Agent receives job and prints automatically
        await waitFor(() => agent.dispatches.length >= 1, 'job dispatched to agent');
        // 6. Status screen polling fallback checks order until completed
        const finalOrder = await waitFor(async () => {
            const res = await fetch(`${baseUrl}/v1/orders/${order.id}?token=${encodeURIComponent(token)}`);
            if (res.status !== 200)
                return false;
            const data = await readJson(res);
            return data.order.status === 'completed' ? data.order : false;
        }, 'order completion');
        assert.equal(finalOrder.status, 'completed');
        assert.ok(finalOrder.pickupToken, 'completed order must have a pickupToken');
        assert.match(finalOrder.pickupToken, /^[A-Z]-\d{3}$/, 'pickup token format like B-047');
    });
    it('serves the order status page at /o/:orderId', async () => {
        const res = await fetch(`${baseUrl}/o/test-order-id`);
        assert.equal(res.status, 200);
        const html = await res.text();
        assert.match(html, /Print Order/);
        assert.match(html, /timeline/);
    });
});
//# sourceMappingURL=t2-web-checkout-flow.test.js.map