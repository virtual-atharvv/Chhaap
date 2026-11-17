import { db } from '@chhaap/db';
import { normalizePhone, toWaId } from '@chhaap/shared';
import { getWhatsAppProvider } from './index.js';
function parseHhMm(value, fallback) {
    const match = (value ?? '').match(/^(\d{1,2}):(\d{2})$/);
    if (!match)
        return fallback;
    const h = Math.min(23, parseInt(match[1], 10));
    const m = Math.min(59, parseInt(match[2], 10));
    return { h, m };
}
function isQuietHours(shop, now = new Date()) {
    const start = shop.settings.quietHoursStart;
    const end = shop.settings.quietHoursEnd;
    if (!start || !end)
        return false;
    const current = now.getHours() * 60 + now.getMinutes();
    const from = parseHhMm(start, { h: 22, m: 0 });
    const to = parseHhMm(end, { h: 8, m: 0 });
    const fromMinutes = from.h * 60 + from.m;
    const toMinutes = to.h * 60 + to.m;
    if (fromMinutes === toMinutes)
        return false;
    return fromMinutes < toMinutes
        ? current >= fromMinutes && current < toMinutes
        : current >= fromMinutes || current < toMinutes;
}
/**
 * Owner-facing WhatsApp alerts and commands. Authorization is strictly the
 * owner's registered phone number bound to a shop; no command is trusted just
 * because it looks like an owner command.
 */
export class ShopOwnerAlerts {
    lastAlertTimes = new Map();
    offlineTimers = new Map();
    async resolveOwner(from) {
        const phone = normalizePhone(from);
        const user = await db.getUserByPhone(phone);
        if (!user || user.role !== 'owner')
            return null;
        const shop = await db.getShopByOwnerId(user.id);
        if (!shop)
            return null;
        const configured = shop.settings.whatsappNumber
            ? toWaId(shop.settings.whatsappNumber)
            : user.phone
                ? toWaId(user.phone)
                : null;
        const incoming = toWaId(from);
        if (!configured || configured !== incoming)
            return null;
        return { shop, ownerWaId: configured };
    }
    async handleOwnerCommand(from, text) {
        const resolved = await this.resolveOwner(from);
        if (!resolved)
            return null;
        const { shop } = resolved;
        const command = text.trim().toLowerCase();
        if (command === 'queue') {
            const orders = await db.getOrdersByShopId(shop.id);
            const active = orders.filter((o) => o.status === 'queued' || o.status === 'printing');
            if (active.length === 0)
                return 'Queue is empty. No pending print jobs.';
            const lines = active.map((o) => `• ${o.token} [${o.status.toUpperCase()}] — ₹${(o.totalPaise / 100).toFixed(2)}`);
            return `Active queue (${active.length}):\n${lines.join('\n')}`;
        }
        if (command === 'pause') {
            await db.updateShop(shop.id, { settings: { ...shop.settings, isOpen: false } });
            return 'Shop orders paused. Customers will be told the shop is temporarily closed.';
        }
        if (command === 'resume') {
            await db.updateShop(shop.id, { settings: { ...shop.settings, isOpen: true } });
            return 'Shop orders resumed. New orders can come in.';
        }
        if (command === 'today') {
            const orders = await db.getOrdersByShopId(shop.id);
            const today = new Date().toISOString().slice(0, 10);
            const paid = orders.filter((o) => o.createdAt.slice(0, 10) === today && ['completed', 'printing', 'queued', 'paid'].includes(o.status));
            const revenue = paid.reduce((sum, o) => sum + o.totalPaise, 0);
            let pages = 0;
            for (const order of paid) {
                for (const item of await db.getOrderItemsByOrderId(order.id)) {
                    pages += item.pageCount * item.settings.copies;
                }
            }
            return `Today at ${shop.name}:\n• Orders: ${paid.length}\n• Pages: ${pages}\n• Revenue: ₹${(revenue / 100).toFixed(2)}`;
        }
        if (command === 'help' || command === 'menu') {
            return 'Owner commands: QUEUE, PAUSE, RESUME, TODAY.';
        }
        return null;
    }
    async sendOwnerTemplate(shop, template, params) {
        if (!shop.settings.whatsappNumber || shop.settings.ownerAlertsEnabled === false)
            return;
        if (isQuietHours(shop))
            return;
        try {
            await getWhatsAppProvider().sendTemplate(toWaId(shop.settings.whatsappNumber), template, 'en', params);
        }
        catch (err) {
            console.warn(`[OwnerAlerts] Could not send ${template}:`, err.message);
        }
    }
    debounced(key, windowMs) {
        const now = Date.now();
        const last = this.lastAlertTimes.get(key) ?? 0;
        if (now - last < windowMs)
            return false;
        this.lastAlertTimes.set(key, now);
        return true;
    }
    async alertPrinterIssue(shopId, printerName, status) {
        if (!this.debounced(`printer:${shopId}:${printerName}:${status}`, 15 * 60 * 1000))
            return;
        const shop = await db.getShopById(shopId);
        if (!shop || shop.settings.printerOfflineAlertEnabled === false)
            return;
        await this.sendOwnerTemplate(shop, 'shop_printer_alert', [shop.name, printerName, status]);
    }
    /**
     * Delays the "agent offline" alert by two minutes so a normal reconnect or
     * agent restart does not page the owner.
     */
    async alertAgentOffline(shopId) {
        if (this.offlineTimers.has(shopId))
            return;
        const timer = setTimeout(() => {
            this.offlineTimers.delete(shopId);
            void this.sendAgentOfflineNow(shopId);
        }, 2 * 60 * 1000);
        timer.unref?.();
        this.offlineTimers.set(shopId, timer);
    }
    async sendAgentOfflineNow(shopId) {
        if (!this.debounced(`agent:${shopId}`, 15 * 60 * 1000))
            return;
        const shop = await db.getShopById(shopId);
        if (!shop || shop.settings.printerOfflineAlertEnabled === false)
            return;
        await this.sendOwnerTemplate(shop, 'shop_printer_alert', [
            shop.name,
            'Shop PC agent',
            'offline (no heartbeat)'
        ]);
    }
    agentBackOnline(shopId) {
        const timer = this.offlineTimers.get(shopId);
        if (timer) {
            clearTimeout(timer);
            this.offlineTimers.delete(shopId);
        }
    }
    async alertOrderFailed(shopId, token, reason) {
        if (!this.debounced(`order:${shopId}:${token}`, 5 * 60 * 1000))
            return;
        const shop = await db.getShopById(shopId);
        if (!shop || shop.settings.orderFailedAlertEnabled === false)
            return;
        await this.sendOwnerTemplate(shop, 'shop_printer_alert', [
            shop.name,
            `order ${token}`,
            `failed (${reason})`
        ]);
    }
    /** Called by the reconciliation loop; sends at most once per local day. */
    async maybeSendDailySummary(now = new Date()) {
        const shops = await db.getAllShops();
        let sent = false;
        for (const shop of shops) {
            if (shop.settings.dailySummaryEnabled === false)
                continue;
            const target = parseHhMm(shop.settings.dailySummaryTime, { h: 21, m: 0 });
            const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            if (shop.settings.lastSummaryDate === today)
                continue;
            const targetMinutes = target.h * 60 + target.m;
            const currentMinutes = now.getHours() * 60 + now.getMinutes();
            if (currentMinutes < targetMinutes || currentMinutes > targetMinutes + 5)
                continue;
            const orders = await db.getOrdersByShopId(shop.id);
            const paid = orders.filter((o) => o.createdAt.slice(0, 10) === today && ['completed', 'printing', 'queued', 'paid'].includes(o.status));
            const revenue = paid.reduce((sum, o) => sum + o.totalPaise, 0);
            let pages = 0;
            for (const order of paid) {
                for (const item of await db.getOrderItemsByOrderId(order.id)) {
                    pages += item.pageCount * item.settings.copies;
                }
            }
            await this.sendOwnerTemplate(shop, 'shop_daily_summary', [
                shop.name,
                String(paid.length),
                String(pages),
                `₹${(revenue / 100).toFixed(2)}`
            ]);
            await db.updateShop(shop.id, {
                settings: { ...shop.settings, lastSummaryDate: today }
            });
            sent = true;
        }
        return sent;
    }
    clearTimers() {
        for (const timer of this.offlineTimers.values())
            clearTimeout(timer);
        this.offlineTimers.clear();
    }
}
export const shopOwnerAlerts = new ShopOwnerAlerts();
//# sourceMappingURL=owner-alerts.js.map