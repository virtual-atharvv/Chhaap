import { type OrderRecord } from '@chhaap/db';
export interface InboundMessageContext {
    from: string;
    messageId: string;
    type: string;
    text?: string;
    document?: {
        id: string;
        mime_type: string;
        filename?: string;
    };
    image?: {
        id: string;
        mime_type: string;
    };
    interactiveReply?: {
        id: string;
        title: string;
    };
}
/**
 * Persistent WhatsApp conversation state machine. State, language, settings
 * and the current order live in the database, so an API restart does not lose
 * a conversation. Every branch is safe to replay for a duplicate webhook.
 */
export declare class ConversationManager {
    handleInbound(msg: InboundMessageContext): Promise<void>;
    private touch;
    private handlePrintCommand;
    private handleRepeat;
    private cancelSession;
    private sendStatus;
    private handleAwaitingFile;
    private friendlyFileError;
    private processFile;
    private handleConfiguring;
    private priceOrder;
    private formatSummary;
    private sendReview;
    private handleReviewReply;
    private sendPaymentLink;
    /** Called by the payment webhook after a verified payment. */
    onOrderPaid(order: OrderRecord): Promise<void>;
    /**
     * Expires sessions and their unpaid draft/awaiting orders. Called by the
     * reconciliation loop; safe to run repeatedly.
     */
    expireSessions(now?: Date): Promise<number>;
}
export declare const conversationManager: ConversationManager;
//# sourceMappingURL=conversation.d.ts.map