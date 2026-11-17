import { parseArgs } from 'node:util';
import { db, defaultRateCards, defaultShopSettings } from '@chhaap/db';
import { normalizePhone, toWaId } from '@chhaap/shared';
import { loadConfig } from './config.js';
export async function runAdminCommand(argv) {
    const [command, ...rest] = argv;
    if (!command) {
        throw new Error('Usage: pnpm admin <command> [options]\nCommands: create-shop, list-shops, set-shop-status, add-staff, seed-demo');
    }
    const config = loadConfig();
    switch (command) {
        case 'create-shop': {
            const { values } = parseArgs({
                args: rest,
                options: {
                    slug: { type: 'string' },
                    name: { type: 'string' },
                    city: { type: 'string' },
                    'owner-phone': { type: 'string' },
                    'owner-name': { type: 'string' },
                    gst: { type: 'string' },
                    'min-order': { type: 'string' },
                    fee: { type: 'string' }
                }
            });
            const slug = values.slug?.trim().toLowerCase();
            const name = values.name?.trim();
            const city = values.city?.trim() || 'Lucknow';
            const rawPhone = values['owner-phone']?.trim();
            if (!slug || !/^[a-z0-9-]+$/.test(slug) || slug.length < 3) {
                throw new Error('Invalid or missing --slug (must be lowercase alphanumeric + dashes, min 3 chars)');
            }
            if (!name) {
                throw new Error('Missing required --name for the shop');
            }
            if (!rawPhone) {
                throw new Error('Missing required --owner-phone');
            }
            const nationalPhone = normalizePhone(rawPhone);
            if (!/^[6-9]\d{9}$/.test(nationalPhone)) {
                throw new Error(`Invalid Indian mobile phone number: "${rawPhone}" (must be 10 digits)`);
            }
            // Check idempotency on slug
            const existing = await db.getShopBySlug(slug);
            if (existing) {
                console.log(`[Admin] Shop with slug "${slug}" already exists (id: ${existing.id}). Idempotent return.`);
                return { success: true, shop: existing, created: false };
            }
            // Find or create owner user
            let owner = await db.getUserByPhone(nationalPhone);
            if (!owner) {
                owner = await db.createUser({
                    phone: nationalPhone,
                    name: values['owner-name']?.trim() || `${name} Owner`,
                    role: 'owner'
                });
            }
            const minOrderPaise = parseInt(values['min-order'] || '500', 10) || 500;
            const feePaise = parseInt(values.fee || '100', 10) || 100;
            const gstPercent = parseFloat(values.gst || '0') || 0;
            const shop = await db.createShop({
                slug,
                name,
                city,
                phone: nationalPhone,
                gstNo: values.gst?.trim() || null,
                ownerId: owner.id,
                status: 'active',
                planId: 'starter',
                settings: defaultShopSettings({
                    minOrderPaise,
                    platformConvenienceFeePaise: feePaise,
                    gstRatePercent: gstPercent,
                    whatsappNumber: toWaId(nationalPhone)
                })
            });
            await db.addShopMember(shop.id, owner.id, 'owner');
            const rates = defaultRateCards(shop.id, minOrderPaise);
            await db.saveRateCards(shop.id, rates);
            console.log('----------------------------------------------------');
            console.log(`[Admin] Shop Created Successfully!`);
            console.log(`  Shop ID:        ${shop.id}`);
            console.log(`  Name:           ${shop.name}`);
            console.log(`  Slug:           ${shop.slug}`);
            console.log(`  City:           ${shop.city}`);
            console.log(`  Status:         ${shop.status}`);
            console.log(`  Owner:          ${owner.name} (${owner.phone})`);
            console.log(`  Rate cards:     12 default rate cards configured`);
            console.log('----------------------------------------------------');
            console.log(`[Next Steps]`);
            console.log(`  1. Customer Web URL:    ${config.publicBaseUrl}/s/${shop.slug}`);
            console.log(`  2. Shop Dashboard URL:  ${config.publicBaseUrl}/shop/${shop.slug}`);
            console.log(`  3. Owner Login:         Open Dashboard and enter ${owner.phone} for WhatsApp OTP`);
            console.log(`  4. Pair PC Print Agent: Settings -> Agent pairing (generate 6-digit code)`);
            console.log(`  5. WhatsApp Opt-in:     Message "PRINT ${shop.slug}" to shop WhatsApp`);
            console.log('----------------------------------------------------');
            return { success: true, shop, owner, created: true };
        }
        case 'list-shops': {
            const shops = await db.getAllShops();
            console.log(`[Admin] Total shops: ${shops.length}`);
            for (const s of shops) {
                console.log(`- ${s.slug} | ${s.name} | ${s.city} | status: ${s.status} | owner: ${s.phone || 'none'}`);
            }
            return { success: true, shops };
        }
        case 'set-shop-status': {
            const slug = rest[0];
            const status = rest[1];
            if (!slug || !status || !['active', 'suspended'].includes(status)) {
                throw new Error('Usage: pnpm admin set-shop-status <slug> active|suspended');
            }
            const shop = await db.getShopBySlug(slug);
            if (!shop)
                throw new Error(`Shop "${slug}" not found`);
            const updated = await db.updateShop(shop.id, { status });
            console.log(`[Admin] Shop "${slug}" status updated to "${status}".`);
            return { success: true, shop: updated };
        }
        case 'add-staff': {
            const { values } = parseArgs({
                args: rest,
                options: {
                    slug: { type: 'string' },
                    phone: { type: 'string' },
                    name: { type: 'string' },
                    role: { type: 'string' }
                }
            });
            const slug = values.slug?.trim().toLowerCase();
            const rawPhone = values.phone?.trim();
            if (!slug || !rawPhone) {
                throw new Error('Usage: pnpm admin add-staff --slug <slug> --phone <phone> [--name <name>] [--role staff]');
            }
            const shop = await db.getShopBySlug(slug);
            if (!shop)
                throw new Error(`Shop "${slug}" not found`);
            const nationalPhone = normalizePhone(rawPhone);
            if (!/^[6-9]\d{9}$/.test(nationalPhone)) {
                throw new Error(`Invalid mobile phone number: "${rawPhone}"`);
            }
            let staffUser = await db.getUserByPhone(nationalPhone);
            if (!staffUser) {
                staffUser = await db.createUser({
                    phone: nationalPhone,
                    name: values.name?.trim() || 'Staff Member',
                    role: 'staff'
                });
            }
            const role = values.role === 'admin' ? 'admin' : 'staff';
            await db.addShopMember(shop.id, staffUser.id, role);
            console.log(`[Admin] Added staff member ${staffUser.phone} (${role}) to "${slug}".`);
            return { success: true, user: staffUser, role };
        }
        case 'seed-demo': {
            if (process.env.NODE_ENV === 'production' || config.nodeEnv === 'production') {
                throw new Error('Refusing to run seed-demo in production environment');
            }
            // Check if campus-xerox already exists
            const existing = await db.getShopBySlug('campus-xerox');
            if (existing) {
                console.log('[Admin] Demo shop "campus-xerox" already exists.');
                return { success: true, shop: existing, seeded: false };
            }
            let owner = await db.getUserByPhone('9876543210');
            if (!owner) {
                owner = await db.createUser({
                    email: 'owner@campusxerox.in',
                    phone: '9876543210',
                    name: 'Ramesh Sharma',
                    role: 'owner'
                });
            }
            const shop = await db.createShop({
                slug: 'campus-xerox',
                name: 'Campus Xerox & Stationary',
                ownerId: owner.id,
                city: 'Lucknow',
                phone: '9876543210',
                status: 'active',
                planId: 'starter',
                settings: defaultShopSettings({
                    minOrderPaise: 500,
                    platformConvenienceFeePaise: 100,
                    gstRatePercent: 0,
                    isOpen: true,
                    upiVpa: 'campusxerox@upi',
                    whatsappNumber: '919876543210'
                })
            });
            await db.addShopMember(shop.id, owner.id, 'owner');
            const rates = defaultRateCards(shop.id, 500);
            await db.saveRateCards(shop.id, rates);
            console.log('[Admin] Demo shop "campus-xerox" seeded successfully.');
            return { success: true, shop, seeded: true };
        }
        default:
            throw new Error(`Unknown admin command: "${command}". Available: create-shop, list-shops, set-shop-status, add-staff, seed-demo`);
    }
}
// Direct execution CLI entrypoint
const isDirectCli = process.argv[1] && (process.argv[1].endsWith('admin.js') ||
    process.argv[1].endsWith('admin.ts'));
if (isDirectCli) {
    runAdminCommand(process.argv.slice(2))
        .then(() => process.exit(0))
        .catch((err) => {
        console.error(`[Admin Error] ${err.message}`);
        process.exit(1);
    });
}
//# sourceMappingURL=admin.js.map