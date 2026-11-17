import { db } from '@chhaap/db';
import { toWaId } from '@chhaap/shared';
import { getWhatsAppProvider } from './index.js';
import { COPY } from './copy.js';
import { getTemplate } from './templates.js';
const WINDOW_24H_MS = 24 * 60 * 60 * 1000;
function rupees(paise) {
    return (paise / 100).toFixed(2);
}
function itemSummary(items) {
    return items
        .map((i) => `• ${i.file}: ${i.pages} pages × ${i.copies} (${i.colorMode.toUpperCase()}, ${i.sides}) — ₹${rupees(i.linePaise)}`)
        .join('\n');
}
/**
 * All customer notifications flow through here and are triggered by order
 * state events. Sending is best-effort: it never blocks or fails printing, and
 * every (order, event) pair is de-duplicated in the database.
 */
export class OrderNotificationService {
    async buildSummary(order) {
        const items = await db.getOrderItemsByOrderId(order.id);
        const lines = [];
        for (const item of items) {
            const file = await db.getFileById(item.fileId);
            lines.push({
                file: file?.originalName ?? 'document',
                pages: item.pageCount,
                copies: item.settings.copies,
                colorMode: item.settings.colorMode,
                sides: item.settings.sides,
                linePaise: item.lineTotalPaise
            });
        }
        const summary = itemSummary(lines);
        const feeLine = `Fee: ₹${rupees(order.feePaise)}`;
        const gstLine = order.gstPaise > 0 ? `GST: ₹${rupees(order.gstPaise)}` : '';
        return [summary, feeLine, gstLine].filter(Boolean).join('\n');
    }
    async resolveTarget(order) {
        const waId = order.customerWaId
            ? order.customerWaId
            : order.customerPhone
                ? toWaId(order.customerPhone)
                : null;
        if (!waId)
            return null;
        // A phone is only stored on a web order when the customer ticked the
        // notification-consent checkbox, so its presence is the consent record.
        if (await db.isOptedOut(waId))
            return null;
        const session = order.customerWaId ? await db.getActiveWaSession(order.customerWaId) : undefined;
        const lang = COPY[session?.lang ?? 'en'];
        const inWindow = Boolean(session && Date.now() - new Date(session.lastInboundAt).getTime() < WINDOW_24H_MS);
        return { waId, lang, inWindow };
    }
    async sendWithRetry(send, label) {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await send();
                return true;
            }
            catch (err) {
                if (attempt === 2) {
                    console.warn(`[Notifier] ${label} failed after 3 attempts:`, err.message);
                    return false;
                }
                await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 250 : 750));
            }
        }
        return false;
    }
    async notify(order, event) {
        try {
            const fresh = (await db.getOrderById(order.id)) ?? order;
            const shouldSend = await db.recordNotification(fresh.id, event);
            if (!shouldSend)
                return;
            const target = await this.resolveTarget(fresh);
            if (!target)
                return;
            const shop = await db.getShopById(fresh.shopId);
            const shopName = shop?.name ?? 'Chhaap Print Shop';
            const provider = getWhatsAppProvider();
            if (event === 'paid') {
                const summary = await this.buildSummary(fresh);
                if (target.inWindow) {
                    await this.sendWithRetry(() => provider.sendText(target.waId, target.lang.receipt(shopName, fresh.token, summary, rupees(fresh.totalPaise))), 'paid text');
                }
                else {
                    await this.sendWithRetry(() => provider.sendTemplate(target.waId, 'order_paid_receipt', 'en', [
                        shopName,
                        fresh.token,
                        `₹${rupees(fresh.totalPaise)}`
                    ]), 'paid template');
                }
                return;
            }
            if (event === 'printing') {
                if (!target.inWindow)
                    return; // optional in-window-only message
                await this.sendWithRetry(() => provider.sendText(target.waId, target.lang.printingStarted(fresh.token)), 'printing text');
                return;
            }
            if (event === 'completed') {
                if (target.inWindow) {
                    await this.sendWithRetry(() => provider.sendText(target.waId, target.lang.printReady(fresh.token, shopName)), 'completed text');
                }
                else {
                    await this.sendWithRetry(() => provider.sendTemplate(target.waId, 'order_ready_pickup', 'en', [shopName, fresh.token]), 'completed template');
                }
                const session = await db.getWaSessionByOrderId(fresh.id);
                if (session)
                    await db.saveWaSession({ ...session, state: 'DONE' });
                return;
            }
            if (event === 'failed' || event === 'refunded') {
                if (target.inWindow) {
                    await this.sendWithRetry(() => provider.sendText(target.waId, event === 'refunded' ? target.lang.refunded(fresh.token) : target.lang.printFailed(fresh.token)), `${event} text`);
                }
                else {
                    await this.sendWithRetry(() => provider.sendTemplate(target.waId, 'order_failed_refund', 'en', [
                        shopName,
                        fresh.token,
                        `₹${rupees(fresh.totalPaise)}`
                    ]), `${event} template`);
                }
            }
        }
        catch (err) {
            // Notifications are strictly best-effort. Printing must never wait on
            // WhatsApp, and a Meta outage must not fail an order.
            console.warn(`[Notifier] ${event} notification failed (ignored):`, err.message);
        }
    }
    async notifyOrderPaid(order) {
        await this.notify(order, 'paid');
    }
    async notifyOrderPrinting(order) {
        await this.notify(order, 'printing');
    }
    async notifyOrderCompleted(order) {
        await this.notify(order, 'completed');
    }
    async notifyOrderFailed(order) {
        await this.notify(order, 'failed');
    }
    async notifyOrderRefunded(order) {
        await this.notify(order, 'refunded');
    }
    /** Template metadata kept discoverable for docs/tests. */
    templateExists(name) {
        return Boolean(getTemplate(name));
    }
}
export const orderNotifier = new OrderNotificationService();
//# sourceMappingURL=notifier.js.map