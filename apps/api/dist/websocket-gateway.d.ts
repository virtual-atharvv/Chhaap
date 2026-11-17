import type { WebSocket } from 'ws';
import type { OrderStatus } from '@chhaap/shared';
type OrderSubscriber = (status: OrderStatus, data: Record<string, unknown>) => void;
export declare class WebSocketGateway {
    private connectedAgents;
    private orderSubscribers;
    private serverBaseUrl;
    private heartbeatTimer;
    setBaseUrl(url: string): void;
    /** Starts the ping/offline scanner once per process. Safe to call twice. */
    start(): void;
    stop(): void;
    subscribeOrder(orderId: string, callback: OrderSubscriber): () => void;
    notifyOrderStatus(orderId: string, status: OrderStatus, data?: Record<string, unknown>): void;
    handleAgentConnection(ws: WebSocket): void;
    private sendToSocket;
    private markAgentOffline;
    private heartbeatScan;
    isShopAgentOnline(shopId: string): boolean;
    hasOnlinePrinter(shopId: string): boolean;
    shopCanAcceptOrders(shopId: string): Promise<boolean>;
    private findConnection;
    /**
     * Reconciles what the agent reports after a reconnect. A job the agent says
     * was spooling/printing is assumed printed to avoid a duplicate copy; jobs
     * that never reached the printer go back to the pending queue.
     */
    private reconcileUnfinishedJobs;
    /** Dispatches every pending job for a shop to its connected agent. */
    dispatchPendingJobsForShop(shopId: string): Promise<number>;
    private handleJobResult;
    private failJob;
}
export declare const gateway: WebSocketGateway;
export {};
//# sourceMappingURL=websocket-gateway.d.ts.map