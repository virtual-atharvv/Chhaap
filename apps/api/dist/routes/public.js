import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { db } from '@chhaap/db';
import { calculateOrderPricing, calculatePricing, DEFAULT_STANDARD_INDIAN_RATES } from '@chhaap/pricing';
import { AgentPairingRequestSchema, CreateDraftOrderSchema, PrintSettingsSchema, UpdateOrderItemSettingsSchema, normalizePhone, safeEqual, sha256Hex } from '@chhaap/shared';
import { storage } from '../storage.js';
import { analyzeDocument } from '../document-processor.js';
import { gateway } from '../websocket-gateway.js';
import { paymentService } from '../payments.js';
import { loadConfig } from '../config.js';
import { clientIp, enforceRateLimit, limiters, verifyTurnstile } from '../rate-limit.js';
function publicOrderView(order) {
    return {
        id: order.id,
        shopId: order.shopId,
        token: order.token,
        pickupToken: order.token,
        channel: order.channel,
        status: order.status,
        subtotalPaise: order.subtotalPaise,
        feePaise: order.feePaise,
        gstPaise: order.gstPaise,
        totalPaise: order.totalPaise,
        currency: order.currency,
        createdAt: order.createdAt,
        paidAt: order.paidAt,
        completedAt: order.completedAt,
        expiresAt: order.expiresAt
    };
}
async function shopPricingConfig(shopId) {
    const shop = await db.getShopById(shopId);
    const rates = await db.getRateCardsByShopId(shopId);
    return {
        minOrderPaise: shop?.settings.minOrderPaise ?? 500,
        platformConvenienceFeePaise: shop?.settings.platformConvenienceFeePaise ?? 100,
        gstRatePercent: shop?.settings.gstRatePercent ?? 0,
        rates: rates.length > 0 ? rates : DEFAULT_STANDARD_INDIAN_RATES
    };
}
async function requireOrderToken(req, reply, order) {
    const query = req.query;
    const body = (req.body ?? {});
    const token = query?.token ?? body?.token;
    if (!token || !safeEqual(String(token), order.publicToken)) {
        reply.code(403).send({ error: 'Invalid or missing order access token' });
        return false;
    }
    return true;
}
export const publicRoutes = async (app) => {
    const config = loadConfig();
    app.get('/healthz', async () => ({ status: 'ok', uptime: Math.round(process.uptime()) }));
    app.get('/readyz', async (_req, reply) => {
        try {
            const ok = await db.ping();
            if (!ok)
                return reply.code(503).send({ status: 'not_ready' });
            return { status: 'ready', database: 'connected', mode: config.nodeEnv };
        }
        catch {
            return reply.code(503).send({ status: 'not_ready', database: 'unavailable' });
        }
    });
    // Shop status & rate card. No auth: this is the standee/counter QR entry.
    app.get('/v1/shops/:slug', async (req, reply) => {
        const { slug } = req.params;
        const shop = await db.getShopBySlug(slug);
        if (!shop)
            return reply.code(404).send({ error: 'Shop not found' });
        const printers = await db.getPrintersByShopId(shop.id);
        const hasOnlinePrinter = printers.some((p) => p.status === 'online');
        const isAgentOnline = gateway.isShopAgentOnline(shop.id);
        const rates = await db.getRateCardsByShopId(shop.id);
        return {
            shop: {
                id: shop.id,
                slug: shop.slug,
                name: shop.name,
                city: shop.city,
                isOpen: shop.settings.isOpen ?? true,
                printerOnline: hasOnlinePrinter && isAgentOnline,
                minOrderPaise: shop.settings.minOrderPaise ?? 500
            },
            printers: printers.map((p) => ({
                id: p.id,
                displayName: p.displayName,
                status: p.status,
                capabilities: p.capabilities
            })),
            rates: rates.length > 0 ? rates : DEFAULT_STANDARD_INDIAN_RATES
        };
    });
    // Upload + server-side analysis. The client never supplies page counts or
    // colour classification; both come from the analysed file record.
    app.post('/v1/uploads', async (req, reply) => {
        if (!enforceRateLimit(req, reply, limiters.uploadIp, `upload:${clientIp(req)}`))
            return;
        if (!(await verifyTurnstile(req.headers['cf-turnstile-response'], clientIp(req)))) {
            return reply.code(400).send({ error: 'Please complete the bot check and try again.' });
        }
        let data;
        try {
            data = await req.file();
        }
        catch (err) {
            const message = err.message;
            if (message.includes('too large') || message.includes('exceeds')) {
                return reply.code(413).send({ error: 'File exceeds the maximum upload size' });
            }
            return reply.code(400).send({ error: 'Invalid multipart upload' });
        }
        if (!data)
            return reply.code(400).send({ error: 'No file uploaded' });
        let saved;
        try {
            saved = await storage.saveStream(data.file, data.filename || 'document.pdf');
        }
        catch (err) {
            return reply.code(400).send({ error: err.message });
        }
        const fileRecord = await db.addFile({
            orderId: null,
            storageKey: saved.storageKey,
            originalName: saved.originalName,
            mime: saved.mime,
            sizeBytes: saved.sizeBytes,
            sha256: saved.sha256,
            scanStatus: 'clean',
            convertedPdfKey: saved.storageKey,
            previewKeys: [],
            pageCount: 1,
            classification: [],
            deleteAfter: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            deletedAt: null
        });
        try {
            const analysis = await analyzeDocument(saved.filePath, saved.originalName, storage.getPreviewsPath(), fileRecord.id, { maxPages: config.maxPages });
            const committed = await storage.commitPrintedPdf(saved, analysis.printedPdfPath, analysis.printedSha256, analysis.printedSizeBytes);
            const updated = await db.updateFile(fileRecord.id, {
                storageKey: committed.storageKey,
                mime: committed.mime,
                sizeBytes: committed.sizeBytes,
                sha256: committed.sha256,
                convertedPdfKey: committed.storageKey,
                previewKeys: analysis.previewFilenames,
                pageCount: analysis.pageCount,
                classification: analysis.perPageClassification
            });
            return {
                fileId: fileRecord.id,
                originalName: updated?.originalName ?? committed.originalName,
                sizeBytes: updated?.sizeBytes ?? committed.sizeBytes,
                pageCount: analysis.pageCount,
                perPageClassification: analysis.perPageClassification,
                previewUrls: analysis.previewFilenames.map((f) => `/previews/${encodeURIComponent(f)}`)
            };
        }
        catch (err) {
            await storage.deleteFile(fileRecord.id).catch(() => { });
            return reply.code(400).send({ error: err.message });
        }
    });
    // Create a draft order. Price is computed here from the stored file
    // analysis; pageCount/classification in the body are ignored.
    app.post('/v1/orders', async (req, reply) => {
        if (!enforceRateLimit(req, reply, limiters.orderIp, `order:${clientIp(req)}`))
            return;
        const parsed = CreateDraftOrderSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: parsed.error.errors[0]?.message ?? 'Invalid order' });
        }
        const input = parsed.data;
        const shop = await db.getShopBySlug(input.shopSlug);
        if (!shop || shop.status !== 'active') {
            return reply.code(404).send({ error: 'Shop not found' });
        }
        if (shop.settings.isOpen === false) {
            return reply.code(409).send({ error: 'Shop is currently closed' });
        }
        if (!(await gateway.shopCanAcceptOrders(shop.id))) {
            return reply.code(409).send({ error: 'The shop printer is offline. Please try again shortly.' });
        }
        const file = await db.getFileById(input.fileId);
        if (!file || file.deletedAt)
            return reply.code(404).send({ error: 'File not found' });
        if (file.pageCount <= 0 || file.classification.length === 0) {
            return reply.code(400).send({ error: 'File has not been analysed yet' });
        }
        const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
        const order = await db.createOrder({
            shopId: shop.id,
            customerPhone: input.customerPhoneConsent && input.customerPhone
                ? normalizePhone(input.customerPhone)
                : null,
            customerEmail: input.customerEmail ?? null,
            channel: 'web',
            idempotencyKey
        });
        // A file belongs to exactly one order; retries of the same idempotent
        // request are allowed to return the order they already created.
        if (file.orderId && file.orderId !== order.id) {
            return reply.code(409).send({ error: 'File has already been used for another order' });
        }
        const existingItems = await db.getOrderItemsByOrderId(order.id);
        if (existingItems.length > 0) {
            return {
                order: await db.getOrderById(order.id),
                item: existingItems[0],
                pricing: calculatePricing({
                    totalPages: file.pageCount,
                    perPageClassification: file.classification,
                    settings: existingItems[0].settings
                }, await shopPricingConfig(shop.id))
            };
        }
        await db.updateFile(file.id, { orderId: order.id });
        const settings = PrintSettingsSchema.parse(input.settings ?? {});
        const pricing = calculatePricing({
            totalPages: file.pageCount,
            perPageClassification: file.classification,
            settings
        }, await shopPricingConfig(shop.id));
        const item = await db.addOrderItem({
            orderId: order.id,
            fileId: file.id,
            settings,
            pageCount: file.pageCount,
            colourPages: pricing.colorPagesCount,
            bwPages: pricing.bwPagesCount,
            sheets: pricing.sheets,
            lineTotalPaise: pricing.subtotalPaise,
            printerId: null
        });
        const updatedOrder = await db.updateOrderTotals(order.id, {
            subtotalPaise: pricing.subtotalPaise,
            feePaise: pricing.feePaise,
            gstPaise: pricing.gstPaise,
            totalPaise: pricing.totalPaise
        });
        return {
            order: updatedOrder ? publicOrderView(updatedOrder) : publicOrderView(order),
            item,
            pricing,
            publicToken: order.publicToken
        };
    });
    // Re-price one item; all money is recalculated on the server.
    app.patch('/v1/orders/:orderId/items/:itemId', async (req, reply) => {
        const { orderId, itemId } = req.params;
        const order = await db.getOrderById(orderId);
        if (!order)
            return reply.code(404).send({ error: 'Order not found' });
        if (!(await requireOrderToken(req, reply, order)))
            return;
        // Once checkout has created a payment intent the amount is frozen: the
        // Razorpay order and the captured webhook must match this order total.
        if (order.status !== 'draft') {
            return reply.code(400).send({ error: 'Cannot change settings after checkout' });
        }
        const parsed = UpdateOrderItemSettingsSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: parsed.error.errors[0]?.message ?? 'Invalid settings' });
        }
        const items = await db.getOrderItemsByOrderId(order.id);
        const item = items.find((i) => i.id === itemId);
        if (!item)
            return reply.code(404).send({ error: 'Order item not found' });
        const pricingInputs = [];
        for (const current of items) {
            const file = await db.getFileById(current.fileId);
            pricingInputs.push({
                totalPages: current.pageCount,
                perPageClassification: file?.classification ?? [],
                settings: current.id === item.id ? parsed.data.settings : current.settings
            });
        }
        const pricing = calculateOrderPricing(pricingInputs, await shopPricingConfig(order.shopId));
        for (let index = 0; index < items.length; index++) {
            const current = items[index];
            const breakdown = pricing.items[index];
            await db.updateOrderItem(current.id, {
                settings: current.id === item.id ? parsed.data.settings : current.settings,
                colourPages: breakdown.colorPagesCount,
                bwPages: breakdown.bwPagesCount,
                sheets: breakdown.sheets,
                lineTotalPaise: breakdown.subtotalPaise
            });
        }
        await db.updateOrderTotals(order.id, {
            subtotalPaise: pricing.subtotalPaise,
            feePaise: pricing.feePaise,
            gstPaise: pricing.gstPaise,
            totalPaise: pricing.totalPaise
        });
        return {
            order: publicOrderView((await db.getOrderById(order.id))),
            item: await db.getOrderItemById(item.id),
            pricing
        };
    });
    // Public order status. The unguessable per-order public_token is mandatory;
    // the pickup token is display-only and never authorises access.
    app.get('/v1/orders/:id', async (req, reply) => {
        const { id } = req.params;
        const order = await db.getOrderById(id);
        if (!order)
            return reply.code(404).send({ error: 'Order not found' });
        if (!(await requireOrderToken(req, reply, order)))
            return;
        const items = await db.getOrderItemsByOrderId(order.id);
        const files = await Promise.all(items.map((i) => db.getFileById(i.fileId)));
        return {
            order: publicOrderView(order),
            items: items.map((item, index) => ({
                ...item,
                file: files[index]
                    ? {
                        id: files[index].id,
                        originalName: files[index].originalName,
                        pageCount: files[index].pageCount,
                        previewKeys: files[index].previewKeys
                    }
                    : null
            }))
        };
    });
    // Server-Sent Events stream, same public_token requirement.
    app.get('/v1/orders/:id/stream', async (req, reply) => {
        const { id } = req.params;
        const order = await db.getOrderById(id);
        if (!order)
            return reply.code(404).send({ error: 'Order not found' });
        if (!(await requireOrderToken(req, reply, order)))
            return;
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.setHeader('X-Accel-Buffering', 'no');
        reply.raw.flushHeaders();
        reply.raw.write(`event: status\ndata: ${JSON.stringify({ status: order.status, token: order.token })}\n\n`);
        const unsubscribe = gateway.subscribeOrder(order.id, (status, data) => {
            reply.raw.write(`event: status\ndata: ${JSON.stringify({ status, token: order.token, ...data })}\n\n`);
            if (['completed', 'failed', 'refunded', 'expired'].includes(status)) {
                reply.raw.end();
            }
        });
        const keepAlive = setInterval(() => reply.raw.write(': keep-alive\n\n'), 20_000);
        keepAlive.unref?.();
        req.raw.on('close', () => {
            clearInterval(keepAlive);
            unsubscribe();
        });
    });
    app.post('/v1/orders/:id/checkout', async (req, reply) => {
        if (!enforceRateLimit(req, reply, limiters.checkoutIp, `checkout:${clientIp(req)}`))
            return;
        const { id } = req.params;
        const order = await db.getOrderById(id);
        if (!order)
            return reply.code(404).send({ error: 'Order not found' });
        if (!(await requireOrderToken(req, reply, order)))
            return;
        try {
            return await paymentService.createCheckout(id);
        }
        catch (err) {
            return reply.code(400).send({ error: err.message });
        }
    });
    // A1: the simulated endpoint is not registered at all unless explicitly
    // enabled in a non-production environment.
    if (config.paymentsMode === 'simulated' && config.nodeEnv !== 'production') {
        app.post('/v1/orders/:id/fake-pay', async (req, reply) => {
            const { id } = req.params;
            const order = await db.getOrderById(id);
            if (!order)
                return reply.code(404).send({ error: 'Order not found' });
            if (!(await requireOrderToken(req, reply, order)))
                return;
            const result = await paymentService.simulateSuccessfulPayment(id, order.publicToken);
            if (!result.success)
                return reply.code(400).send({ error: result.error });
            return { success: true, order: publicOrderView((await db.getOrderById(id))) };
        });
        app.get('/v1/pay/:linkId', async (req, reply) => {
            const { linkId } = req.params;
            const payment = await db.getPaymentByPaymentLinkId(linkId);
            if (!payment)
                return reply.code(404).send({ error: 'Payment link not found' });
            const order = await db.getOrderById(payment.orderId);
            if (!order)
                return reply.code(404).send({ error: 'Order not found' });
            const raw = payment.raw;
            const shop = await db.getShopById(order.shopId);
            return {
                amountPaise: order.totalPaise,
                currency: order.currency,
                status: order.status,
                expired: raw?.expiresAt ? new Date(raw.expiresAt).getTime() < Date.now() : false,
                shopName: shop?.name ?? 'Print shop',
                token: order.status === 'awaiting_payment' ? undefined : order.token
            };
        });
        app.post('/v1/pay/:linkId/pay', async (req, reply) => {
            const { linkId } = req.params;
            const result = await paymentService.simulatePaymentLinkPaid(linkId);
            if (!result.success)
                return reply.code(400).send({ error: result.error });
            return { success: true };
        });
    }
    // Agent file download: only a short-lived signed URL is accepted.
    app.get('/v1/files/:fileId/download', async (req, reply) => {
        const { fileId } = req.params;
        const { exp, sig } = req.query;
        if (!storage.verifyFileSignature(fileId, exp, sig)) {
            return reply.code(403).send({ error: 'Invalid or expired download signature' });
        }
        const file = await db.getFileById(fileId);
        if (!file || file.deletedAt)
            return reply.code(404).send({ error: 'File not found' });
        let stat;
        try {
            stat = await fs.stat(storage.getFilePath(file.storageKey));
        }
        catch {
            return reply.code(404).send({ error: 'File not found' });
        }
        reply.header('Content-Type', 'application/pdf');
        reply.header('Content-Length', stat.size);
        reply.header('Content-Disposition', `attachment; filename="${storage.sanitizeFilename(file.originalName)}"`);
        reply.header('Cache-Control', 'no-store');
        return reply.send(storage.createReadStream(file.storageKey));
    });
    // Agent pairing. The 6-digit code is single-use, expires in 10 minutes and
    // is stored only as a hash.
    app.post('/v1/agents/pair', async (req, reply) => {
        if (!enforceRateLimit(req, reply, limiters.agentPair, `pair:${clientIp(req)}`))
            return;
        const parsed = AgentPairingRequestSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: parsed.error.errors[0]?.message ?? 'Invalid pairing code' });
        }
        const agent = await db.getAgentByPairingCode(parsed.data.pairingCode, config.agentTokenPepper);
        if (!agent) {
            return reply.code(400).send({ error: 'Invalid or expired 6-digit pairing code' });
        }
        const rawToken = `agent_tok_${crypto.randomBytes(32).toString('hex')}`;
        await db.updateAgent(agent.id, {
            tokenHash: sha256Hex(rawToken + config.agentTokenPepper),
            pairingCode: null,
            pairingCodeExpiresAt: null,
            pairingAttempts: 0,
            os: parsed.data.os,
            name: parsed.data.agentName
        });
        const wsBase = config.publicBaseUrl.replace(/^http/, 'ws').replace(/\/$/, '');
        return {
            agentId: agent.id,
            shopId: agent.shopId,
            token: rawToken,
            wsUrl: `${wsBase}/v1/agent/connect`
        };
    });
};
//# sourceMappingURL=public.js.map