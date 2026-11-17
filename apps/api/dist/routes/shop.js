import crypto from 'node:crypto';
import { db } from '@chhaap/db';
import { RateCardEntrySchema, generateSixDigitCode, normalizePhone, sha256Hex, toWaId } from '@chhaap/shared';
import { requireShopAuth, requireRole } from '../auth.js';
import { loadConfig } from '../config.js';
import { gateway } from '../websocket-gateway.js';
import { paymentService } from '../payments.js';
function authUser(req) {
    const user = req.user;
    if (!user)
        throw new Error('Authenticated user missing');
    return user;
}
function publicAgent(agent) {
    return {
        id: agent.id,
        name: agent.name,
        status: agent.status,
        version: agent.version,
        lastSeenAt: agent.lastSeenAt,
        os: agent.os,
        createdAt: agent.createdAt,
        pairingExpiresAt: agent.pairingCodeExpiresAt
    };
}
export const shopRoutes = async (app) => {
    const config = loadConfig();
    // Every route in this plugin is tenant-scoped by the token's shopId. There
    // is deliberately no shop id/slug parameter accepted from the client.
    app.addHook('preHandler', async (req, reply) => {
        await requireShopAuth(req, reply);
    });
    app.get('/v1/shop/me', async (req) => {
        const user = authUser(req);
        const shop = await db.getShopById(user.shopId);
        return {
            user: { id: user.userId, role: user.role },
            shop
        };
    });
    app.get('/v1/shop/queue', async (req) => {
        const user = authUser(req);
        const shop = await db.getShopById(user.shopId);
        const orders = await db.getOrdersByShopId(user.shopId);
        const active = orders.filter((o) => ['paid', 'queued', 'printing', 'failed', 'awaiting_payment'].includes(o.status));
        const enriched = await Promise.all(active.map(async (order) => {
            const items = await db.getOrderItemsByOrderId(order.id);
            const files = await Promise.all(items.map((i) => db.getFileById(i.fileId)));
            return {
                order,
                items: items.map((item, index) => ({
                    ...item,
                    file: files[index]
                        ? {
                            id: files[index].id,
                            originalName: files[index].originalName,
                            pageCount: files[index].pageCount
                        }
                        : null
                }))
            };
        }));
        return {
            shop: shop
                ? {
                    id: shop.id,
                    slug: shop.slug,
                    name: shop.name,
                    isOpen: shop.settings.isOpen ?? true,
                    settings: shop.settings
                }
                : null,
            agentOnline: gateway.isShopAgentOnline(user.shopId),
            orders: enriched
        };
    });
    app.get('/v1/shop/orders/:id', async (req, reply) => {
        const user = authUser(req);
        const { id } = req.params;
        const order = await db.getOrderById(id);
        // Cross-shop access is indistinguishable from a missing order.
        if (!order || order.shopId !== user.shopId) {
            return reply.code(404).send({ error: 'Order not found' });
        }
        const items = await db.getOrderItemsByOrderId(order.id);
        return { order, items };
    });
    app.post('/v1/shop/orders/:id/cancel', async (req, reply) => {
        const user = authUser(req);
        const { id } = req.params;
        const order = await db.getOrderById(id);
        if (!order || order.shopId !== user.shopId) {
            return reply.code(404).send({ error: 'Order not found' });
        }
        if (order.status === 'draft' || order.status === 'awaiting_payment') {
            const result = await db.transitionOrderStatus(order.id, 'expired', {
                reason: 'cancelled_by_shop'
            });
            if (!result.success)
                return reply.code(400).send({ error: result.error });
            gateway.notifyOrderStatus(order.id, 'expired');
            return { success: true, order: result.order };
        }
        if (['paid', 'queued', 'printing', 'failed'].includes(order.status)) {
            const refund = await paymentService.refundOrder(order.id, 'cancelled_by_shop');
            if (!refund.success)
                return reply.code(400).send({ error: refund.error });
            return { success: true, refundId: refund.refundId };
        }
        return reply.code(400).send({ error: `Cannot cancel an order in status ${order.status}` });
    });
    // Manual reprint. Creates fresh jobs for completed/failed orders; the
    // customer is never charged twice.
    app.post('/v1/shop/orders/:id/reprint', async (req, reply) => {
        const user = authUser(req);
        const { id } = req.params;
        const order = await db.getOrderById(id);
        if (!order || order.shopId !== user.shopId) {
            return reply.code(404).send({ error: 'Order not found' });
        }
        if (!['completed', 'failed', 'queued'].includes(order.status)) {
            return reply.code(400).send({ error: `Cannot reprint an order in status ${order.status}` });
        }
        const items = await db.getOrderItemsByOrderId(order.id);
        let created = 0;
        for (const item of items) {
            const existing = await db.getPrintJobsByOrderItemId(item.id);
            if (existing.some((j) => j.status === 'pending' || j.status === 'dispatched' || j.status === 'printing')) {
                continue;
            }
            await db.createPrintJob({ orderItemId: item.id, printerId: null, status: 'pending' });
            created++;
        }
        if (created === 0) {
            return reply.code(409).send({ error: 'A print job is already active for this order' });
        }
        if (order.status === 'failed') {
            await db.transitionOrderStatus(order.id, 'queued', { reason: 'manual_reprint' });
        }
        await db.logEvent(order.id, user.shopId, 'order.reprint', {
            by: user.userId,
            jobs: created
        });
        await gateway.dispatchPendingJobsForShop(user.shopId);
        return { success: true, jobsCreated: created };
    });
    app.post('/v1/shop/orders/:id/collect', async (req, reply) => {
        const user = authUser(req);
        const { id } = req.params;
        const order = await db.getOrderById(id);
        if (!order || order.shopId !== user.shopId) {
            return reply.code(404).send({ error: 'Order not found' });
        }
        await db.logEvent(order.id, user.shopId, 'order.collected', { by: user.userId });
        return { success: true, token: order.token };
    });
    app.get('/v1/shop/rates', async (req) => {
        const user = authUser(req);
        const rates = await db.getRateCardsByShopId(user.shopId);
        return { rates };
    });
    app.put('/v1/shop/rates', async (req, reply) => {
        const user = authUser(req);
        if (!requireRole(user, ['owner', 'admin'])) {
            return reply.code(403).send({ error: 'Only the shop owner can change rates' });
        }
        const body = req.body;
        if (!Array.isArray(body?.rates)) {
            return reply.code(400).send({ error: 'rates must be an array' });
        }
        const parsed = [];
        for (const entry of body.rates) {
            const result = RateCardEntrySchema.safeParse(entry);
            if (!result.success) {
                return reply.code(400).send({ error: result.error.errors[0]?.message ?? 'Invalid rate' });
            }
            parsed.push(result.data);
        }
        const shop = await db.getShopById(user.shopId);
        await db.saveRateCards(user.shopId, parsed.map((rate) => ({
            ...rate,
            id: `rate-${user.shopId}-${rate.paperSize}-${rate.colorMode}-${rate.sides}`,
            shopId: user.shopId,
            printerId: null,
            minOrderPaise: shop?.settings.minOrderPaise ?? 500
        })));
        return { rates: await db.getRateCardsByShopId(user.shopId) };
    });
    app.get('/v1/shop/printers', async (req) => {
        const user = authUser(req);
        const printers = await db.getPrintersByShopId(user.shopId);
        return { printers, agentOnline: gateway.isShopAgentOnline(user.shopId) };
    });
    app.get('/v1/shop/agents', async (req) => {
        const user = authUser(req);
        const agents = await db.getAgentsByShopId(user.shopId);
        return { agents: agents.map(publicAgent) };
    });
    app.post('/v1/shop/agents/code', async (req, reply) => {
        const user = authUser(req);
        if (!requireRole(user, ['owner', 'admin'])) {
            return reply.code(403).send({ error: 'Only the shop owner can pair an agent' });
        }
        const body = (req.body ?? {});
        const code = generateSixDigitCode();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
        const placeholderHash = sha256Hex(crypto.randomUUID() + config.agentTokenPepper);
        const agent = await db.createAgent({
            shopId: user.shopId,
            name: (body.name ?? 'Shop PC Agent').slice(0, 100),
            tokenHash: placeholderHash,
            pairingCode: sha256Hex(code + config.agentTokenPepper),
            pairingCodeExpiresAt: expiresAt
        });
        return {
            agentId: agent.id,
            pairingCode: code,
            expiresAt,
            expiresInMinutes: 10
        };
    });
    app.post('/v1/shop/agents/:agentId/rotate-token', async (req, reply) => {
        const user = authUser(req);
        if (!requireRole(user, ['owner', 'admin'])) {
            return reply.code(403).send({ error: 'Only the shop owner can rotate agent tokens' });
        }
        const { agentId } = req.params;
        const agent = await db.getAgentById(agentId);
        if (!agent || agent.shopId !== user.shopId) {
            return reply.code(404).send({ error: 'Agent not found' });
        }
        const rawToken = `agent_tok_${crypto.randomBytes(32).toString('hex')}`;
        await db.updateAgent(agent.id, {
            tokenHash: sha256Hex(rawToken + config.agentTokenPepper)
        });
        return { agentId: agent.id, token: rawToken };
    });
    app.get('/v1/shop/settings', async (req, reply) => {
        const user = authUser(req);
        const shop = await db.getShopById(user.shopId);
        if (!shop)
            return reply.code(404).send({ error: 'Shop not found' });
        return { settings: shop.settings };
    });
    app.put('/v1/shop/settings', async (req, reply) => {
        const user = authUser(req);
        if (!requireRole(user, ['owner', 'admin'])) {
            return reply.code(403).send({ error: 'Only the shop owner can change settings' });
        }
        const shop = await db.getShopById(user.shopId);
        if (!shop)
            return reply.code(404).send({ error: 'Shop not found' });
        const body = (req.body ?? {});
        const next = { ...shop.settings };
        if (typeof body.isOpen === 'boolean')
            next.isOpen = body.isOpen;
        if (typeof body.ownerAlertsEnabled === 'boolean')
            next.ownerAlertsEnabled = body.ownerAlertsEnabled;
        if (typeof body.printerOfflineAlertEnabled === 'boolean') {
            next.printerOfflineAlertEnabled = body.printerOfflineAlertEnabled;
        }
        if (typeof body.orderFailedAlertEnabled === 'boolean') {
            next.orderFailedAlertEnabled = body.orderFailedAlertEnabled;
        }
        if (typeof body.dailySummaryEnabled === 'boolean')
            next.dailySummaryEnabled = body.dailySummaryEnabled;
        if (typeof body.whatsappNumber === 'string') {
            const digits = normalizePhone(body.whatsappNumber);
            if (digits.length !== 10) {
                return reply.code(400).send({ error: 'Invalid WhatsApp number' });
            }
            next.whatsappNumber = toWaId(digits);
        }
        for (const key of ['dailySummaryTime', 'quietHoursStart', 'quietHoursEnd']) {
            const value = body[key];
            if (value === undefined)
                continue;
            if (typeof value !== 'string' || !/^\d{1,2}:\d{2}$/.test(value)) {
                return reply.code(400).send({ error: `${key} must be HH:MM` });
            }
            next[key] = value;
        }
        for (const key of ['minOrderPaise', 'platformConvenienceFeePaise']) {
            const value = body[key];
            if (value === undefined)
                continue;
            if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
                return reply.code(400).send({ error: `${key} must be a non-negative integer (paise)` });
            }
            next[key] = value;
        }
        if (body.gstRatePercent !== undefined) {
            const value = body.gstRatePercent;
            if (typeof value !== 'number' || value < 0 || value > 100) {
                return reply.code(400).send({ error: 'gstRatePercent must be between 0 and 100' });
            }
            next.gstRatePercent = value;
        }
        const updated = await db.updateShop(shop.id, { settings: next });
        return { settings: updated?.settings ?? next };
    });
    app.get('/v1/shop/analytics', async (req) => {
        const user = authUser(req);
        const orders = await db.getOrdersByShopId(user.shopId);
        const today = new Date().toISOString().slice(0, 10);
        const paidOrders = orders.filter((o) => o.createdAt.slice(0, 10) === today &&
            ['paid', 'queued', 'printing', 'completed'].includes(o.status));
        let totalRevenuePaise = 0;
        let totalBwPages = 0;
        let totalColorPages = 0;
        let totalSheets = 0;
        for (const order of paidOrders) {
            totalRevenuePaise += order.totalPaise;
            for (const item of await db.getOrderItemsByOrderId(order.id)) {
                totalBwPages += item.bwPages * item.settings.copies;
                totalColorPages += item.colourPages * item.settings.copies;
                totalSheets += item.sheets;
            }
        }
        return {
            todayRevenueRupees: (totalRevenuePaise / 100).toFixed(2),
            totalOrders: paidOrders.length,
            totalBwPages,
            totalColorPages,
            totalSheets
        };
    });
};
//# sourceMappingURL=shop.js.map