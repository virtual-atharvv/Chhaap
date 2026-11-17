export declare class ReconciliationCron {
    private timer;
    start(intervalMs?: number): void;
    stop(): void;
    runReconciliation(now?: Date): Promise<{
        expiredOrders: number;
        reattemptedJobs: number;
        failedJobs: number;
        expiredSessions: number;
    }>;
}
export declare const reconciliationCron: ReconciliationCron;
//# sourceMappingURL=reconciliation.d.ts.map