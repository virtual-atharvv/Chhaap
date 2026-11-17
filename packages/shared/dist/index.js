import { z } from 'zod';
import crypto from 'node:crypto';
// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================
export const ORDER_STATUSES = [
    'draft',
    'awaiting_payment',
    'paid',
    'queued',
    'printing',
    'completed',
    'failed',
    'refunded',
    'expired'
];
export const ORDER_CHANNELS = ['web', 'whatsapp'];
export const PRINT_JOB_STATUSES = [
    'pending',
    'dispatched',
    'printing',
    'done',
    'failed',
    'cancelled'
];
export const PRINTER_STATUSES = [
    'online',
    'offline',
    'paper_out',
    'error',
    'busy'
];
export const SHOP_STATUSES = ['pending', 'active', 'suspended'];
export const FILE_SCAN_STATUSES = ['pending', 'clean', 'infected', 'failed'];
export const PAPER_SIZES = ['A4', 'A3', 'Legal'];
export const COLOR_MODES = ['bw', 'color', 'smart'];
export const SIDES_OPTIONS = ['single', 'duplex'];
export const PAGES_PER_SHEET = [1, 2, 4, 6, 9];
export const FIT_MODES = ['fit', 'fill'];
export const ORIENTATIONS = ['auto', 'portrait', 'landscape'];
// WhatsApp conversation states
export const WA_SESSION_STATES = [
    'IDLE',
    'AWAITING_FILE',
    'CONFIGURING',
    'REVIEW',
    'AWAITING_PAYMENT',
    'TRACKING',
    'DONE'
];
export const WA_LANGUAGES = ['en', 'hi', 'hinglish'];
export const ORDER_EVENTS = ['paid', 'printing', 'completed', 'failed', 'refunded'];
// ============================================================================
// ORDER STATE MACHINE (single source of truth)
// ============================================================================
const ALLOWED_ORDER_TRANSITIONS = {
    draft: ['awaiting_payment', 'expired'],
    awaiting_payment: ['paid', 'expired'],
    paid: ['queued', 'refunded'],
    queued: ['printing', 'failed', 'refunded'],
    printing: ['completed', 'failed', 'refunded'],
    completed: [],
    failed: ['queued', 'refunded'],
    refunded: [],
    expired: []
};
export function canTransitionOrder(from, to) {
    const allowed = ALLOWED_ORDER_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
}
export function allowedOrderTransitions(from) {
    return [...(ALLOWED_ORDER_TRANSITIONS[from] ?? [])];
}
// ============================================================================
// ZOD SCHEMAS & TYPES
// ============================================================================
export const INDIAN_PHONE_REGEX = /^[6-9]\d{9}$/;
export const PrintSettingsSchema = z.object({
    copies: z.number().int().min(1).max(500).default(1),
    paperSize: z.enum(PAPER_SIZES).default('A4'),
    colorMode: z.enum(COLOR_MODES).default('bw'),
    sides: z.enum(SIDES_OPTIONS).default('single'),
    pagesPerSheet: z
        .number()
        .refine((val) => PAGES_PER_SHEET.includes(val), {
        message: 'Must be 1, 2, 4, 6, or 9'
    })
        .default(1),
    orientation: z.enum(ORIENTATIONS).default('auto'),
    fitMode: z.enum(FIT_MODES).default('fit'),
    pageRange: z
        .string()
        .max(500)
        .regex(/^[0-9,\-\s]*$/, 'Page range may only contain numbers, commas and dashes')
        .optional() // e.g. "1-5, 8, 11-13" or empty for all
});
export const PrinterCapabilitiesSchema = z.object({
    systemName: z.string().min(1).max(200),
    displayName: z.string().min(1).max(200),
    color: z.boolean(),
    duplex: z.boolean(),
    papers: z.array(z.string()).min(1),
    dpi: z.number().optional()
});
export const RateCardEntrySchema = z.object({
    paperSize: z.enum(PAPER_SIZES),
    colorMode: z.enum(['bw', 'color']),
    sides: z.enum(SIDES_OPTIONS),
    pricePerPagePaise: z.number().int().min(0).max(1_000_000)
});
export const ShopPricingConfigSchema = z.object({
    minOrderPaise: z.number().int().min(0).default(500), // Default min ₹5
    platformConvenienceFeePaise: z.number().int().min(0).default(100), // Default ₹1
    gstRatePercent: z.number().min(0).max(100).default(0), // 0% by default for small shops
    rates: z.array(RateCardEntrySchema)
});
// Order creation input. Page count / colour classification are NEVER accepted
// from the client: the server reads them from the analysed file record.
export const CreateDraftOrderSchema = z.object({
    shopSlug: z.string().min(1).max(100),
    fileId: z.string().min(1),
    customerPhone: z.string().regex(INDIAN_PHONE_REGEX, 'Invalid 10-digit Indian phone number').optional(),
    customerPhoneConsent: z.boolean().default(false),
    customerEmail: z.string().email().optional(),
    channel: z.enum(ORDER_CHANNELS).default('web'),
    settings: PrintSettingsSchema.default({}),
    idempotencyKey: z.string().min(8).max(200).optional()
});
export const UpdateOrderItemSettingsSchema = z.object({
    settings: PrintSettingsSchema
});
export const UploadResultSchema = z.object({
    fileId: z.string(),
    originalName: z.string(),
    sizeBytes: z.number(),
    pageCount: z.number(),
    perPageClassification: z.array(z.object({ pageNumber: z.number().int(), isColor: z.boolean() })),
    previewUrls: z.array(z.string())
});
// Agent Pairing Input
export const AgentPairingRequestSchema = z.object({
    pairingCode: z.string().regex(/^\d{6}$/),
    agentName: z.string().max(100).default('Shop PC Agent'),
    os: z.string().max(50).default('linux')
});
// Auth OTP schemas
export const RequestOtpSchema = z.object({
    phone: z
        .string()
        .transform((v) => normalizePhone(v))
        .refine((v) => INDIAN_PHONE_REGEX.test(v), {
        message: 'Valid 10-digit Indian phone number required'
    })
});
export const VerifyOtpSchema = z.object({
    phone: z
        .string()
        .transform((v) => normalizePhone(v))
        .refine((v) => INDIAN_PHONE_REGEX.test(v), {
        message: 'Valid 10-digit Indian phone number required'
    }),
    code: z.string().length(6)
});
// ============================================================================
// HELPERS
// ============================================================================
/**
 * Human pickup token, e.g. "B-047". Display only; never an auth credential.
 */
export function generatePickupToken() {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O (ambiguous)
    const letter = letters.charAt(crypto.randomInt(0, letters.length));
    const num = crypto.randomInt(100, 1000);
    return `${letter}-${num}`;
}
/**
 * Unguessable public token for customer status pages and the SSE stream.
 */
export function generatePublicToken() {
    return crypto.randomBytes(24).toString('hex');
}
/** Cryptographically secure 6-digit pairing/OTP code. */
export function generateSixDigitCode() {
    return String(crypto.randomInt(100000, 1000000));
}
/**
 * Normalises an Indian phone/WhatsApp id to its 10-digit national number.
 * Accepts: 9876543210, +91 98765 43210, 919876543210, whatsapp:+919...
 */
export function normalizePhone(input) {
    const digits = String(input ?? '').replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91'))
        return digits.slice(2);
    if (digits.length === 11 && digits.startsWith('0'))
        return digits.slice(1);
    if (digits.length > 10)
        return digits.slice(-10);
    return digits;
}
/** WhatsApp id used by the Cloud API is E.164 digits without '+'. */
export function toWaId(phone) {
    const national = normalizePhone(phone);
    return national.length === 10 ? `91${national}` : national;
}
export function maskPhone(input) {
    const digits = String(input ?? '').replace(/\D/g, '');
    if (digits.length < 4)
        return '****';
    return `******${digits.slice(-4)}`;
}
export function sha256Hex(input) {
    return crypto.createHash('sha256').update(input).digest('hex');
}
/** Constant-time comparison that never throws on different lengths. */
export function safeEqual(a, b) {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length)
        return false;
    return crypto.timingSafeEqual(ab, bb);
}
export function hmacSha256Hex(secret, payload) {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}
/** Basic E.164 formatting for outbound notifications. */
export function formatE164Indian(phone) {
    const national = normalizePhone(phone);
    return national.length === 10 ? `+91${national}` : phone;
}
// ============================================================================
// CHECKOUT CONTRACT (T2)
// ============================================================================
export const SimulatedCheckoutResponseSchema = z.object({
    mode: z.literal('simulated'),
    orderId: z.string(),
    amountPaise: z.number().int().nonnegative(),
    currency: z.string(),
    simulatedPayUrl: z.string()
});
export const RazorpayCheckoutResponseSchema = z.object({
    mode: z.literal('razorpay'),
    orderId: z.string(),
    amountPaise: z.number().int().nonnegative(),
    currency: z.string(),
    keyId: z.string(),
    razorpayOrderId: z.string(),
    prefill: z
        .object({
        contact: z.string().optional()
    })
        .optional()
});
export const CheckoutResponseSchema = z.discriminatedUnion('mode', [
    SimulatedCheckoutResponseSchema,
    RazorpayCheckoutResponseSchema
]);
//# sourceMappingURL=index.js.map