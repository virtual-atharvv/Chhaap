import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const dataDir = path.join(os.tmpdir(), `chhaap-config-test-${crypto.randomUUID()}`);
const baseEnv = {
    NODE_ENV: 'test',
    DB_MODE: 'memory',
    PAYMENTS_MODE: 'simulated',
    WHATSAPP_MODE: 'mock',
    JWT_SECRET: 'test_jwt_secret_at_least_32_characters_long',
    RAZORPAY_KEY_ID: 'rzp_test_key',
    RAZORPAY_KEY_SECRET: 'rzp_test_secret',
    RAZORPAY_WEBHOOK_SECRET: 'rzp_test_webhook_secret',
    PUBLIC_BASE_URL: 'http://localhost:4000',
    LOG_LEVEL: 'silent'
};
const productionEnv = {
    ...baseEnv,
    NODE_ENV: 'production',
    DB_MODE: 'postgres',
    DATABASE_URL: 'postgresql://chhaap:test@127.0.0.1:5432/chhaap_test',
    PAYMENTS_MODE: 'razorpay',
    WHATSAPP_MODE: 'cloud',
    WHATSAPP_ACCESS_TOKEN: 'test-access-token',
    WHATSAPP_PHONE_NUMBER_ID: 'test-phone-number-id',
    WHATSAPP_APP_SECRET: 'test-wa-app-secret',
    WHATSAPP_VERIFY_TOKEN: 'test-wa-verify-token',
    WHATSAPP_PLATFORM_NUMBER: '919876543210'
};
function applyEnv(values) {
    for (const [key, value] of Object.entries(values))
        process.env[key] = value;
}
function clearEnv(keys) {
    for (const key of keys)
        delete process.env[key];
}
let configModule;
let serverModule;
before(async () => {
    await fs.mkdir(dataDir, { recursive: true });
    applyEnv(baseEnv);
    process.env.CHHAAP_DATA_DIR = dataDir;
    configModule = await import('../dist/config.js');
    serverModule = await import('../dist/server.js');
});
after(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
});
describe('A1 production configuration guards', () => {
    it('refuses simulated payments in production', () => {
        applyEnv({ ...baseEnv, NODE_ENV: 'production', PAYMENTS_MODE: 'simulated' });
        assert.throws(() => configModule.loadConfig(), /Simulated payments cannot be enabled/);
        applyEnv(baseEnv);
    });
    it('refuses the mock WhatsApp provider in production', () => {
        applyEnv({ ...productionEnv, WHATSAPP_MODE: 'mock' });
        assert.throws(() => configModule.loadConfig(), /WHATSAPP_MODE=mock/);
        applyEnv(baseEnv);
    });
    it('refuses the in-memory database in production', () => {
        applyEnv({ ...productionEnv, DB_MODE: 'memory' });
        assert.throws(() => configModule.loadConfig(), /DB_MODE=postgres/);
        applyEnv(baseEnv);
    });
    it('refuses cloud WhatsApp mode without every required credential', () => {
        applyEnv(productionEnv);
        clearEnv(['WHATSAPP_ACCESS_TOKEN']);
        assert.throws(() => configModule.loadConfig(), /WHATSAPP_ACCESS_TOKEN/);
        applyEnv(productionEnv);
    });
    it('accepts a complete production configuration', () => {
        applyEnv(productionEnv);
        const config = configModule.loadConfig();
        assert.equal(config.nodeEnv, 'production');
        assert.equal(config.paymentsMode, 'razorpay');
        assert.equal(config.whatsappMode, 'cloud');
        applyEnv(baseEnv);
    });
});
describe('A1 simulated routes are registration-gated', () => {
    it('registers fake-pay and payment-link simulation in non-production simulated mode', async () => {
        applyEnv(baseEnv);
        const app = await serverModule.buildServer();
        try {
            const routes = app.printRoutes();
            assert.match(routes, /fake-pay/);
            const link = await app.inject({ method: 'GET', url: '/v1/pay/missing-link' });
            assert.equal(link.statusCode, 404);
            assert.equal(link.json().error, 'Payment link not found');
        }
        finally {
            await app.close();
        }
    });
    it('does not register any simulated payment route in production', async () => {
        applyEnv(productionEnv);
        const app = await serverModule.buildServer();
        try {
            const routes = app.printRoutes();
            assert.doesNotMatch(routes, /fake-pay/);
            const fakePay = await app.inject({
                method: 'POST',
                url: '/v1/orders/00000000-0000-0000-0000-000000000000/fake-pay'
            });
            assert.equal(fakePay.statusCode, 404);
            const link = await app.inject({ method: 'GET', url: '/v1/pay/missing-link' });
            assert.equal(link.statusCode, 404);
            assert.notEqual(link.json().error, 'Payment link not found');
        }
        finally {
            await app.close();
            applyEnv(baseEnv);
        }
    });
});
//# sourceMappingURL=config.test.js.map