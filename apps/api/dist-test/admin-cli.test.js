import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '@chhaap/db';
let adminModule;
before(async () => {
    adminModule = await import('../dist/admin.js');
});
describe('T3 — Admin CLI and Shop Provisioning', () => {
    it('creates a new shop with owner, rate cards, and settings idempotently', async () => {
        const slug = 'lucknow-stationery';
        const result = await adminModule.runAdminCommand([
            'create-shop',
            '--slug',
            slug,
            '--name',
            'Lucknow Stationery Corner',
            '--city',
            'Lucknow',
            '--owner-phone',
            '9876501234',
            '--owner-name',
            'Vikram Singh',
            '--gst',
            '5',
            '--min-order',
            '1000',
            '--fee',
            '150'
        ]);
        assert.equal(result.success, true);
        assert.equal(result.shop.slug, slug);
        assert.equal(result.shop.name, 'Lucknow Stationery Corner');
        assert.equal(result.shop.settings.minOrderPaise, 1000);
        assert.equal(result.shop.settings.platformConvenienceFeePaise, 150);
        // Verify shop is in DB
        const fetched = await db.getShopBySlug(slug);
        assert.ok(fetched);
        assert.equal(fetched.status, 'active');
        // Verify owner was created
        const owner = await db.getUserByPhone('9876501234');
        assert.ok(owner);
        assert.equal(owner.name, 'Vikram Singh');
        assert.equal(fetched.ownerId, owner.id);
        // Verify default rate cards exist
        const rates = await db.getRateCardsByShopId(fetched.id);
        assert.equal(rates.length, 12, '12 default rate card combinations (A4, A3, Legal)');
        // Idempotency check: running create-shop again does not fail or duplicate
        const idempotentResult = await adminModule.runAdminCommand([
            'create-shop',
            '--slug',
            slug,
            '--name',
            'Lucknow Stationery Corner',
            '--city',
            'Lucknow',
            '--owner-phone',
            '9876501234'
        ]);
        assert.equal(idempotentResult.success, true);
        assert.equal(idempotentResult.shop.slug, slug);
    });
    it('lists shops and updates shop status', async () => {
        const slug = 'lucknow-stationery';
        const listResult = await adminModule.runAdminCommand(['list-shops']);
        assert.equal(listResult.success, true);
        assert.ok(listResult.shops.some((s) => s.slug === slug));
        // Suspend shop
        const suspendResult = await adminModule.runAdminCommand([
            'set-shop-status',
            slug,
            'suspended'
        ]);
        assert.equal(suspendResult.success, true);
        const suspended = await db.getShopBySlug(slug);
        assert.equal(suspended?.status, 'suspended');
        // Reactivate shop
        const activateResult = await adminModule.runAdminCommand([
            'set-shop-status',
            slug,
            'active'
        ]);
        assert.equal(activateResult.success, true);
        const active = await db.getShopBySlug(slug);
        assert.equal(active?.status, 'active');
    });
    it('adds staff members to an existing shop', async () => {
        const slug = 'lucknow-stationery';
        const staffResult = await adminModule.runAdminCommand([
            'add-staff',
            '--slug',
            slug,
            '--phone',
            '9876509999',
            '--name',
            'Staff Member 1'
        ]);
        assert.equal(staffResult.success, true);
        const staffUser = await db.getUserByPhone('9876509999');
        assert.ok(staffUser);
        assert.equal(staffUser.role, 'staff');
    });
    it('refuses seed-demo in production environment', async () => {
        const prevEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            await assert.rejects(async () => {
                await adminModule.runAdminCommand(['seed-demo']);
            }, /production/i);
        }
        finally {
            process.env.NODE_ENV = prevEnv;
        }
    });
});
//# sourceMappingURL=admin-cli.test.js.map