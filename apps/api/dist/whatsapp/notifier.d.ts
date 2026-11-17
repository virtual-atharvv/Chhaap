import { type OrderRecord } from '@chhaap/db';
/**
 * All customer notifications flow through here and are triggered by order
 * state events. Sending is best-effort: it never blocks or fails printing, and
 * every (order, event) pair is de-duplicated in the database.
 */
export declare class OrderNotificationService {
    private buildSummary;
    private resolveTarget;
    private sendWithRetry;
    private notify;
    notifyOrderPaid(order: OrderRecord): Promise<void>;
    notifyOrderPrinting(order: OrderRecord): Promise<void>;
    notifyOrderCompleted(order: OrderRecord): Promise<void>;
    notifyOrderFailed(order: OrderRecord): Promise<void>;
    notifyOrderRefunded(order: OrderRecord): Promise<void>;
    /** Template metadata kept discoverable for docs/tests. */
    templateExists(name: string): boolean;
}
export declare const orderNotifier: OrderNotificationService;
//# sourceMappingURL=notifier.d.ts.map