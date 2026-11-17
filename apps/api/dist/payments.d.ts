import { type CheckoutResponse } from '@chhaap/shared';
export type CheckoutSession = CheckoutResponse;
export interface PaymentLinkSession {
    paymentLinkId: string;
    shortUrl: string;
    amountPaise: number;
    expiresAt: string;
}
/**
 * All Razorpay interaction lives here. The cardinal rule: money is integer
 * paise, the server computes the amount, and only a verified webhook (or the
 * explicit simulated-payment path in non-production) may mark an order paid.
 */
export declare class PaymentService {
    private get config();
    private razorpayRequest;
    /** Creates (or reuses) a Razorpay order for the web checkout. */
    createCheckout(orderId: string): Promise<CheckoutSession>;
    /**
     * Creates (or reuses) a UPI-first Razorpay Payment Link for WhatsApp. The
     * link amount is always the server-computed order total.
     */
    createPaymentLink(orderId: string): Promise<PaymentLinkSession>;
    /** HMAC-SHA256 verification against the exact raw request bytes. */
    verifyWebhookSignature(rawBody: string | Buffer, signature: string | undefined): boolean;
    /**
     * Handles a verified payment.captured / payment_link.paid event. This is the
     * only production path to `queued`; every step is idempotent so duplicate
     * webhook deliveries cannot double-print or double-charge.
     */
    handlePaymentCaptured(params: {
        razorpayOrderId?: string;
        paymentLinkId?: string;
        razorpayPaymentId: string;
        amountPaise: number;
        currency?: string;
        method?: string;
        rawPayload?: Record<string, unknown>;
    }): Promise<{
        success: boolean;
        orderId?: string;
        error?: string;
        alreadyProcessed?: boolean;
    }>;
    /** Simulated payment is compiled in but gated by config at boot and at call time. */
    simulateSuccessfulPayment(orderId: string, publicToken?: string): Promise<{
        success: boolean;
        error?: string;
    }>;
    /** Simulated completion of a payment link (used by the local /pay page). */
    simulatePaymentLinkPaid(paymentLinkId: string): Promise<{
        success: boolean;
        orderId?: string;
        error?: string;
    }>;
    /**
     * Refunds a captured payment. In live mode this calls Razorpay's refund API;
     * in simulated mode it records the refund locally. Never throws into the
     * print pipeline: callers log and continue.
     */
    refundOrder(orderId: string, reason: string): Promise<{
        success: boolean;
        refundId?: string;
        error?: string;
    }>;
}
export declare const paymentService: PaymentService;
//# sourceMappingURL=payments.d.ts.map