import { z } from 'zod';
export declare const ORDER_STATUSES: readonly ["draft", "awaiting_payment", "paid", "queued", "printing", "completed", "failed", "refunded", "expired"];
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export declare const ORDER_CHANNELS: readonly ["web", "whatsapp"];
export type OrderChannel = (typeof ORDER_CHANNELS)[number];
export declare const PRINT_JOB_STATUSES: readonly ["pending", "dispatched", "printing", "done", "failed", "cancelled"];
export type PrintJobStatus = (typeof PRINT_JOB_STATUSES)[number];
export declare const PRINTER_STATUSES: readonly ["online", "offline", "paper_out", "error", "busy"];
export type PrinterStatus = (typeof PRINTER_STATUSES)[number];
export declare const SHOP_STATUSES: readonly ["pending", "active", "suspended"];
export type ShopStatus = (typeof SHOP_STATUSES)[number];
export declare const FILE_SCAN_STATUSES: readonly ["pending", "clean", "infected", "failed"];
export type FileScanStatus = (typeof FILE_SCAN_STATUSES)[number];
export declare const PAPER_SIZES: readonly ["A4", "A3", "Legal"];
export type PaperSize = (typeof PAPER_SIZES)[number];
export declare const COLOR_MODES: readonly ["bw", "color", "smart"];
export type ColorMode = (typeof COLOR_MODES)[number];
export declare const SIDES_OPTIONS: readonly ["single", "duplex"];
export type Sides = (typeof SIDES_OPTIONS)[number];
export declare const PAGES_PER_SHEET: readonly [1, 2, 4, 6, 9];
export type PagesPerSheet = (typeof PAGES_PER_SHEET)[number];
export declare const FIT_MODES: readonly ["fit", "fill"];
export type FitMode = (typeof FIT_MODES)[number];
export declare const ORIENTATIONS: readonly ["auto", "portrait", "landscape"];
export type Orientation = (typeof ORIENTATIONS)[number];
export declare const WA_SESSION_STATES: readonly ["IDLE", "AWAITING_FILE", "CONFIGURING", "REVIEW", "AWAITING_PAYMENT", "TRACKING", "DONE"];
export type WaSessionState = (typeof WA_SESSION_STATES)[number];
export declare const WA_LANGUAGES: readonly ["en", "hi", "hinglish"];
export type WaLanguage = (typeof WA_LANGUAGES)[number];
export declare const ORDER_EVENTS: readonly ["paid", "printing", "completed", "failed", "refunded"];
export type OrderEvent = (typeof ORDER_EVENTS)[number];
export interface PageClassification {
    pageNumber: number;
    isColor: boolean;
}
export interface DocumentAnalysis {
    pageCount: number;
    perPageClassification: PageClassification[];
    previewFilenames: string[];
    printedPdfPath: string;
    printedSha256: string;
    printedSizeBytes: number;
}
export declare function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean;
export declare function allowedOrderTransitions(from: OrderStatus): OrderStatus[];
export declare const INDIAN_PHONE_REGEX: RegExp;
export declare const PrintSettingsSchema: z.ZodObject<{
    copies: z.ZodDefault<z.ZodNumber>;
    paperSize: z.ZodDefault<z.ZodEnum<["A4", "A3", "Legal"]>>;
    colorMode: z.ZodDefault<z.ZodEnum<["bw", "color", "smart"]>>;
    sides: z.ZodDefault<z.ZodEnum<["single", "duplex"]>>;
    pagesPerSheet: z.ZodDefault<z.ZodEffects<z.ZodNumber, 9 | 2 | 6 | 4 | 1, number>>;
    orientation: z.ZodDefault<z.ZodEnum<["auto", "portrait", "landscape"]>>;
    fitMode: z.ZodDefault<z.ZodEnum<["fit", "fill"]>>;
    pageRange: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    copies: number;
    paperSize: "A4" | "A3" | "Legal";
    colorMode: "bw" | "color" | "smart";
    sides: "single" | "duplex";
    pagesPerSheet: 9 | 2 | 6 | 4 | 1;
    orientation: "auto" | "portrait" | "landscape";
    fitMode: "fit" | "fill";
    pageRange?: string | undefined;
}, {
    copies?: number | undefined;
    paperSize?: "A4" | "A3" | "Legal" | undefined;
    colorMode?: "bw" | "color" | "smart" | undefined;
    sides?: "single" | "duplex" | undefined;
    pagesPerSheet?: number | undefined;
    orientation?: "auto" | "portrait" | "landscape" | undefined;
    fitMode?: "fit" | "fill" | undefined;
    pageRange?: string | undefined;
}>;
export type PrintSettings = z.infer<typeof PrintSettingsSchema>;
export declare const PrinterCapabilitiesSchema: z.ZodObject<{
    systemName: z.ZodString;
    displayName: z.ZodString;
    color: z.ZodBoolean;
    duplex: z.ZodBoolean;
    papers: z.ZodArray<z.ZodString, "many">;
    dpi: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    color: boolean;
    duplex: boolean;
    systemName: string;
    displayName: string;
    papers: string[];
    dpi?: number | undefined;
}, {
    color: boolean;
    duplex: boolean;
    systemName: string;
    displayName: string;
    papers: string[];
    dpi?: number | undefined;
}>;
export type PrinterCapabilities = z.infer<typeof PrinterCapabilitiesSchema>;
export declare const RateCardEntrySchema: z.ZodObject<{
    paperSize: z.ZodEnum<["A4", "A3", "Legal"]>;
    colorMode: z.ZodEnum<["bw", "color"]>;
    sides: z.ZodEnum<["single", "duplex"]>;
    pricePerPagePaise: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    paperSize: "A4" | "A3" | "Legal";
    colorMode: "bw" | "color";
    sides: "single" | "duplex";
    pricePerPagePaise: number;
}, {
    paperSize: "A4" | "A3" | "Legal";
    colorMode: "bw" | "color";
    sides: "single" | "duplex";
    pricePerPagePaise: number;
}>;
export type RateCardEntry = z.infer<typeof RateCardEntrySchema>;
export declare const ShopPricingConfigSchema: z.ZodObject<{
    minOrderPaise: z.ZodDefault<z.ZodNumber>;
    platformConvenienceFeePaise: z.ZodDefault<z.ZodNumber>;
    gstRatePercent: z.ZodDefault<z.ZodNumber>;
    rates: z.ZodArray<z.ZodObject<{
        paperSize: z.ZodEnum<["A4", "A3", "Legal"]>;
        colorMode: z.ZodEnum<["bw", "color"]>;
        sides: z.ZodEnum<["single", "duplex"]>;
        pricePerPagePaise: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        paperSize: "A4" | "A3" | "Legal";
        colorMode: "bw" | "color";
        sides: "single" | "duplex";
        pricePerPagePaise: number;
    }, {
        paperSize: "A4" | "A3" | "Legal";
        colorMode: "bw" | "color";
        sides: "single" | "duplex";
        pricePerPagePaise: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    minOrderPaise: number;
    platformConvenienceFeePaise: number;
    gstRatePercent: number;
    rates: {
        paperSize: "A4" | "A3" | "Legal";
        colorMode: "bw" | "color";
        sides: "single" | "duplex";
        pricePerPagePaise: number;
    }[];
}, {
    rates: {
        paperSize: "A4" | "A3" | "Legal";
        colorMode: "bw" | "color";
        sides: "single" | "duplex";
        pricePerPagePaise: number;
    }[];
    minOrderPaise?: number | undefined;
    platformConvenienceFeePaise?: number | undefined;
    gstRatePercent?: number | undefined;
}>;
export type ShopPricingConfig = z.infer<typeof ShopPricingConfigSchema>;
export declare const CreateDraftOrderSchema: z.ZodObject<{
    shopSlug: z.ZodString;
    fileId: z.ZodString;
    customerPhone: z.ZodOptional<z.ZodString>;
    customerPhoneConsent: z.ZodDefault<z.ZodBoolean>;
    customerEmail: z.ZodOptional<z.ZodString>;
    channel: z.ZodDefault<z.ZodEnum<["web", "whatsapp"]>>;
    settings: z.ZodDefault<z.ZodObject<{
        copies: z.ZodDefault<z.ZodNumber>;
        paperSize: z.ZodDefault<z.ZodEnum<["A4", "A3", "Legal"]>>;
        colorMode: z.ZodDefault<z.ZodEnum<["bw", "color", "smart"]>>;
        sides: z.ZodDefault<z.ZodEnum<["single", "duplex"]>>;
        pagesPerSheet: z.ZodDefault<z.ZodEffects<z.ZodNumber, 9 | 2 | 6 | 4 | 1, number>>;
        orientation: z.ZodDefault<z.ZodEnum<["auto", "portrait", "landscape"]>>;
        fitMode: z.ZodDefault<z.ZodEnum<["fit", "fill"]>>;
        pageRange: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        copies: number;
        paperSize: "A4" | "A3" | "Legal";
        colorMode: "bw" | "color" | "smart";
        sides: "single" | "duplex";
        pagesPerSheet: 9 | 2 | 6 | 4 | 1;
        orientation: "auto" | "portrait" | "landscape";
        fitMode: "fit" | "fill";
        pageRange?: string | undefined;
    }, {
        copies?: number | undefined;
        paperSize?: "A4" | "A3" | "Legal" | undefined;
        colorMode?: "bw" | "color" | "smart" | undefined;
        sides?: "single" | "duplex" | undefined;
        pagesPerSheet?: number | undefined;
        orientation?: "auto" | "portrait" | "landscape" | undefined;
        fitMode?: "fit" | "fill" | undefined;
        pageRange?: string | undefined;
    }>>;
    idempotencyKey: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    shopSlug: string;
    fileId: string;
    customerPhoneConsent: boolean;
    channel: "web" | "whatsapp";
    settings: {
        copies: number;
        paperSize: "A4" | "A3" | "Legal";
        colorMode: "bw" | "color" | "smart";
        sides: "single" | "duplex";
        pagesPerSheet: 9 | 2 | 6 | 4 | 1;
        orientation: "auto" | "portrait" | "landscape";
        fitMode: "fit" | "fill";
        pageRange?: string | undefined;
    };
    customerPhone?: string | undefined;
    customerEmail?: string | undefined;
    idempotencyKey?: string | undefined;
}, {
    shopSlug: string;
    fileId: string;
    customerPhone?: string | undefined;
    customerPhoneConsent?: boolean | undefined;
    customerEmail?: string | undefined;
    channel?: "web" | "whatsapp" | undefined;
    settings?: {
        copies?: number | undefined;
        paperSize?: "A4" | "A3" | "Legal" | undefined;
        colorMode?: "bw" | "color" | "smart" | undefined;
        sides?: "single" | "duplex" | undefined;
        pagesPerSheet?: number | undefined;
        orientation?: "auto" | "portrait" | "landscape" | undefined;
        fitMode?: "fit" | "fill" | undefined;
        pageRange?: string | undefined;
    } | undefined;
    idempotencyKey?: string | undefined;
}>;
export type CreateDraftOrderInput = z.infer<typeof CreateDraftOrderSchema>;
export declare const UpdateOrderItemSettingsSchema: z.ZodObject<{
    settings: z.ZodObject<{
        copies: z.ZodDefault<z.ZodNumber>;
        paperSize: z.ZodDefault<z.ZodEnum<["A4", "A3", "Legal"]>>;
        colorMode: z.ZodDefault<z.ZodEnum<["bw", "color", "smart"]>>;
        sides: z.ZodDefault<z.ZodEnum<["single", "duplex"]>>;
        pagesPerSheet: z.ZodDefault<z.ZodEffects<z.ZodNumber, 9 | 2 | 6 | 4 | 1, number>>;
        orientation: z.ZodDefault<z.ZodEnum<["auto", "portrait", "landscape"]>>;
        fitMode: z.ZodDefault<z.ZodEnum<["fit", "fill"]>>;
        pageRange: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        copies: number;
        paperSize: "A4" | "A3" | "Legal";
        colorMode: "bw" | "color" | "smart";
        sides: "single" | "duplex";
        pagesPerSheet: 9 | 2 | 6 | 4 | 1;
        orientation: "auto" | "portrait" | "landscape";
        fitMode: "fit" | "fill";
        pageRange?: string | undefined;
    }, {
        copies?: number | undefined;
        paperSize?: "A4" | "A3" | "Legal" | undefined;
        colorMode?: "bw" | "color" | "smart" | undefined;
        sides?: "single" | "duplex" | undefined;
        pagesPerSheet?: number | undefined;
        orientation?: "auto" | "portrait" | "landscape" | undefined;
        fitMode?: "fit" | "fill" | undefined;
        pageRange?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    settings: {
        copies: number;
        paperSize: "A4" | "A3" | "Legal";
        colorMode: "bw" | "color" | "smart";
        sides: "single" | "duplex";
        pagesPerSheet: 9 | 2 | 6 | 4 | 1;
        orientation: "auto" | "portrait" | "landscape";
        fitMode: "fit" | "fill";
        pageRange?: string | undefined;
    };
}, {
    settings: {
        copies?: number | undefined;
        paperSize?: "A4" | "A3" | "Legal" | undefined;
        colorMode?: "bw" | "color" | "smart" | undefined;
        sides?: "single" | "duplex" | undefined;
        pagesPerSheet?: number | undefined;
        orientation?: "auto" | "portrait" | "landscape" | undefined;
        fitMode?: "fit" | "fill" | undefined;
        pageRange?: string | undefined;
    };
}>;
export type UpdateOrderItemSettingsInput = z.infer<typeof UpdateOrderItemSettingsSchema>;
export declare const UploadResultSchema: z.ZodObject<{
    fileId: z.ZodString;
    originalName: z.ZodString;
    sizeBytes: z.ZodNumber;
    pageCount: z.ZodNumber;
    perPageClassification: z.ZodArray<z.ZodObject<{
        pageNumber: z.ZodNumber;
        isColor: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        pageNumber: number;
        isColor: boolean;
    }, {
        pageNumber: number;
        isColor: boolean;
    }>, "many">;
    previewUrls: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    fileId: string;
    originalName: string;
    sizeBytes: number;
    pageCount: number;
    perPageClassification: {
        pageNumber: number;
        isColor: boolean;
    }[];
    previewUrls: string[];
}, {
    fileId: string;
    originalName: string;
    sizeBytes: number;
    pageCount: number;
    perPageClassification: {
        pageNumber: number;
        isColor: boolean;
    }[];
    previewUrls: string[];
}>;
export declare const AgentPairingRequestSchema: z.ZodObject<{
    pairingCode: z.ZodString;
    agentName: z.ZodDefault<z.ZodString>;
    os: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    pairingCode: string;
    agentName: string;
    os: string;
}, {
    pairingCode: string;
    agentName?: string | undefined;
    os?: string | undefined;
}>;
export type AgentPairingRequest = z.infer<typeof AgentPairingRequestSchema>;
export declare const RequestOtpSchema: z.ZodObject<{
    phone: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
}, "strip", z.ZodTypeAny, {
    phone: string;
}, {
    phone: string;
}>;
export type RequestOtpInput = z.infer<typeof RequestOtpSchema>;
export declare const VerifyOtpSchema: z.ZodObject<{
    phone: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
    code: z.ZodString;
}, "strip", z.ZodTypeAny, {
    code: string;
    phone: string;
}, {
    code: string;
    phone: string;
}>;
export type VerifyOtpInput = z.infer<typeof VerifyOtpSchema>;
export interface UnfinishedJob {
    jobId: string;
    state: 'accepted' | 'downloading' | 'spooling' | 'printing' | 'unknown';
}
export type AgentToCloudMessage = {
    type: 'hello';
    agentId: string;
    token: string;
    version: string;
    os: string;
    printers: PrinterCapabilities[];
    unfinishedJobs?: UnfinishedJob[];
    unfinishedJobIds?: string[];
} | {
    type: 'job.accepted';
    jobId: string;
} | {
    type: 'job.progress';
    jobId: string;
    state: 'downloading' | 'spooling' | 'printing';
    pagesPrinted?: number;
} | {
    type: 'job.result';
    jobId: string;
    ok: boolean;
    pagesPrinted: number;
    error?: string;
} | {
    type: 'printer.status';
    printerId: string;
    status: PrinterStatus;
    supplies?: Record<string, unknown>;
} | {
    type: 'pong';
    timestamp: number;
};
export type CloudToAgentMessage = {
    type: 'ack';
    serverTime: number;
    config: {
        heartbeatIntervalMs: number;
        minAgentVersion?: string;
        reprintPolicy?: 'manual';
        printers?: Array<{
            id: string;
            systemName: string;
        }>;
    };
} | {
    type: 'job.dispatch';
    jobId: string;
    fileUrl: string;
    sha256: string;
    settings: PrintSettings;
    printerSystemName: string;
    documentName: string;
    pageCount: number;
} | {
    type: 'ping';
    timestamp: number;
} | {
    type: 'error';
    message: string;
};
/**
 * Human pickup token, e.g. "B-047". Display only; never an auth credential.
 */
export declare function generatePickupToken(): string;
/**
 * Unguessable public token for customer status pages and the SSE stream.
 */
export declare function generatePublicToken(): string;
/** Cryptographically secure 6-digit pairing/OTP code. */
export declare function generateSixDigitCode(): string;
/**
 * Normalises an Indian phone/WhatsApp id to its 10-digit national number.
 * Accepts: 9876543210, +91 98765 43210, 919876543210, whatsapp:+919...
 */
export declare function normalizePhone(input: string | null | undefined): string;
/** WhatsApp id used by the Cloud API is E.164 digits without '+'. */
export declare function toWaId(phone: string): string;
export declare function maskPhone(input: string | null | undefined): string;
export declare function sha256Hex(input: string | Buffer): string;
/** Constant-time comparison that never throws on different lengths. */
export declare function safeEqual(a: string, b: string): boolean;
export declare function hmacSha256Hex(secret: string, payload: string | Buffer): string;
/** Basic E.164 formatting for outbound notifications. */
export declare function formatE164Indian(phone: string): string;
export declare const SimulatedCheckoutResponseSchema: z.ZodObject<{
    mode: z.ZodLiteral<"simulated">;
    orderId: z.ZodString;
    amountPaise: z.ZodNumber;
    currency: z.ZodString;
    simulatedPayUrl: z.ZodString;
}, "strip", z.ZodTypeAny, {
    mode: "simulated";
    orderId: string;
    amountPaise: number;
    currency: string;
    simulatedPayUrl: string;
}, {
    mode: "simulated";
    orderId: string;
    amountPaise: number;
    currency: string;
    simulatedPayUrl: string;
}>;
export type SimulatedCheckoutResponse = z.infer<typeof SimulatedCheckoutResponseSchema>;
export declare const RazorpayCheckoutResponseSchema: z.ZodObject<{
    mode: z.ZodLiteral<"razorpay">;
    orderId: z.ZodString;
    amountPaise: z.ZodNumber;
    currency: z.ZodString;
    keyId: z.ZodString;
    razorpayOrderId: z.ZodString;
    prefill: z.ZodOptional<z.ZodObject<{
        contact: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        contact?: string | undefined;
    }, {
        contact?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    mode: "razorpay";
    orderId: string;
    amountPaise: number;
    currency: string;
    keyId: string;
    razorpayOrderId: string;
    prefill?: {
        contact?: string | undefined;
    } | undefined;
}, {
    mode: "razorpay";
    orderId: string;
    amountPaise: number;
    currency: string;
    keyId: string;
    razorpayOrderId: string;
    prefill?: {
        contact?: string | undefined;
    } | undefined;
}>;
export type RazorpayCheckoutResponse = z.infer<typeof RazorpayCheckoutResponseSchema>;
export declare const CheckoutResponseSchema: z.ZodDiscriminatedUnion<"mode", [z.ZodObject<{
    mode: z.ZodLiteral<"simulated">;
    orderId: z.ZodString;
    amountPaise: z.ZodNumber;
    currency: z.ZodString;
    simulatedPayUrl: z.ZodString;
}, "strip", z.ZodTypeAny, {
    mode: "simulated";
    orderId: string;
    amountPaise: number;
    currency: string;
    simulatedPayUrl: string;
}, {
    mode: "simulated";
    orderId: string;
    amountPaise: number;
    currency: string;
    simulatedPayUrl: string;
}>, z.ZodObject<{
    mode: z.ZodLiteral<"razorpay">;
    orderId: z.ZodString;
    amountPaise: z.ZodNumber;
    currency: z.ZodString;
    keyId: z.ZodString;
    razorpayOrderId: z.ZodString;
    prefill: z.ZodOptional<z.ZodObject<{
        contact: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        contact?: string | undefined;
    }, {
        contact?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    mode: "razorpay";
    orderId: string;
    amountPaise: number;
    currency: string;
    keyId: string;
    razorpayOrderId: string;
    prefill?: {
        contact?: string | undefined;
    } | undefined;
}, {
    mode: "razorpay";
    orderId: string;
    amountPaise: number;
    currency: string;
    keyId: string;
    razorpayOrderId: string;
    prefill?: {
        contact?: string | undefined;
    } | undefined;
}>]>;
export type CheckoutResponse = z.infer<typeof CheckoutResponseSchema>;
//# sourceMappingURL=index.d.ts.map