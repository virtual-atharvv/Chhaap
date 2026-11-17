/**
 * Owner-facing WhatsApp alerts and commands. Authorization is strictly the
 * owner's registered phone number bound to a shop; no command is trusted just
 * because it looks like an owner command.
 */
export declare class ShopOwnerAlerts {
    private lastAlertTimes;
    private offlineTimers;
    private resolveOwner;
    handleOwnerCommand(from: string, text: string): Promise<string | null>;
    private sendOwnerTemplate;
    private debounced;
    alertPrinterIssue(shopId: string, printerName: string, status: string): Promise<void>;
    /**
     * Delays the "agent offline" alert by two minutes so a normal reconnect or
     * agent restart does not page the owner.
     */
    alertAgentOffline(shopId: string): Promise<void>;
    private sendAgentOfflineNow;
    agentBackOnline(shopId: string): void;
    alertOrderFailed(shopId: string, token: string, reason: string): Promise<void>;
    /** Called by the reconciliation loop; sends at most once per local day. */
    maybeSendDailySummary(now?: Date): Promise<boolean>;
    clearTimers(): void;
}
export declare const shopOwnerAlerts: ShopOwnerAlerts;
//# sourceMappingURL=owner-alerts.d.ts.map