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
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_CHANNELS = ['web', 'whatsapp'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

export const PRINT_JOB_STATUSES = [
  'pending',
  'dispatched',
  'printing',
  'done',
  'failed',
  'cancelled'
] as const;
export type PrintJobStatus = (typeof PRINT_JOB_STATUSES)[number];

export const PRINTER_STATUSES = [
  'online',
  'offline',
  'paper_out',
  'error',
  'busy'
] as const;
export type PrinterStatus = (typeof PRINTER_STATUSES)[number];

export const SHOP_STATUSES = ['pending', 'active', 'suspended'] as const;
export type ShopStatus = (typeof SHOP_STATUSES)[number];

export const FILE_SCAN_STATUSES = ['pending', 'clean', 'infected', 'failed'] as const;
export type FileScanStatus = (typeof FILE_SCAN_STATUSES)[number];

export const PAPER_SIZES = ['A4', 'A3', 'Legal'] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];

export const COLOR_MODES = ['bw', 'color', 'smart'] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

export const SIDES_OPTIONS = ['single', 'duplex'] as const;
export type Sides = (typeof SIDES_OPTIONS)[number];

export const PAGES_PER_SHEET = [1, 2, 4, 6, 9] as const;
export type PagesPerSheet = (typeof PAGES_PER_SHEET)[number];

export const FIT_MODES = ['fit', 'fill'] as const;
export type FitMode = (typeof FIT_MODES)[number];

export const ORIENTATIONS = ['auto', 'portrait', 'landscape'] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

// WhatsApp conversation states
export const WA_SESSION_STATES = [
  'IDLE',
  'AWAITING_FILE',
  'CONFIGURING',
  'REVIEW',
  'AWAITING_PAYMENT',
  'TRACKING',
  'DONE'
] as const;
export type WaSessionState = (typeof WA_SESSION_STATES)[number];

export const WA_LANGUAGES = ['en', 'hi', 'hinglish'] as const;
export type WaLanguage = (typeof WA_LANGUAGES)[number];

export const ORDER_EVENTS = ['paid', 'printing', 'completed', 'failed', 'refunded'] as const;
export type OrderEvent = (typeof ORDER_EVENTS)[number];

export interface PageClassification {
  pageNumber: number; // 1-indexed
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

// ============================================================================
// ORDER STATE MACHINE (single source of truth)
// ============================================================================

const ALLOWED_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
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

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  const allowed = ALLOWED_ORDER_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export function allowedOrderTransitions(from: OrderStatus): OrderStatus[] {
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
    .refine((val): val is PagesPerSheet => PAGES_PER_SHEET.includes(val as PagesPerSheet), {
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
export type PrintSettings = z.infer<typeof PrintSettingsSchema>;

export const PrinterCapabilitiesSchema = z.object({
  systemName: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  color: z.boolean(),
  duplex: z.boolean(),
  papers: z.array(z.string()).min(1),
  dpi: z.number().optional()
});
export type PrinterCapabilities = z.infer<typeof PrinterCapabilitiesSchema>;

export const RateCardEntrySchema = z.object({
  paperSize: z.enum(PAPER_SIZES),
  colorMode: z.enum(['bw', 'color']),
  sides: z.enum(SIDES_OPTIONS),
  pricePerPagePaise: z.number().int().min(0).max(1_000_000)
});
export type RateCardEntry = z.infer<typeof RateCardEntrySchema>;

export const ShopPricingConfigSchema = z.object({
  minOrderPaise: z.number().int().min(0).default(500), // Default min ₹5
  platformConvenienceFeePaise: z.number().int().min(0).default(100), // Default ₹1
  gstRatePercent: z.number().min(0).max(100).default(0), // 0% by default for small shops
  rates: z.array(RateCardEntrySchema)
});
export type ShopPricingConfig = z.infer<typeof ShopPricingConfigSchema>;

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
export type CreateDraftOrderInput = z.infer<typeof CreateDraftOrderSchema>;

export const UpdateOrderItemSettingsSchema = z.object({
  settings: PrintSettingsSchema
});
export type UpdateOrderItemSettingsInput = z.infer<typeof UpdateOrderItemSettingsSchema>;

export const UploadResultSchema = z.object({
  fileId: z.string(),
  originalName: z.string(),
  sizeBytes: z.number(),
  pageCount: z.number(),
  perPageClassification: z.array(
    z.object({ pageNumber: z.number().int(), isColor: z.boolean() })
  ),
  previewUrls: z.array(z.string())
});

// Agent Pairing Input
export const AgentPairingRequestSchema = z.object({
  pairingCode: z.string().regex(/^\d{6}$/),
  agentName: z.string().max(100).default('Shop PC Agent'),
  os: z.string().max(50).default('linux')
});
export type AgentPairingRequest = z.infer<typeof AgentPairingRequestSchema>;

// Auth OTP schemas
export const RequestOtpSchema = z.object({
  phone: z
    .string()
    .transform((v) => normalizePhone(v))
    .refine((v): v is string => INDIAN_PHONE_REGEX.test(v), {
      message: 'Valid 10-digit Indian phone number required'
    })
});
export type RequestOtpInput = z.infer<typeof RequestOtpSchema>;

export const VerifyOtpSchema = z.object({
  phone: z
    .string()
    .transform((v) => normalizePhone(v))
    .refine((v): v is string => INDIAN_PHONE_REGEX.test(v), {
      message: 'Valid 10-digit Indian phone number required'
    }),
  code: z.string().length(6)
});
export type VerifyOtpInput = z.infer<typeof VerifyOtpSchema>;

// ============================================================================
// WEBSOCKET AGENT PROTOCOL
// ============================================================================

export interface UnfinishedJob {
  jobId: string;
  state: 'accepted' | 'downloading' | 'spooling' | 'printing' | 'unknown';
}

export type AgentToCloudMessage =
  | {
      type: 'hello';
      agentId: string;
      token: string;
      version: string;
      os: string;
      printers: PrinterCapabilities[];
      unfinishedJobs?: UnfinishedJob[];
      unfinishedJobIds?: string[];
    }
  | {
      type: 'job.accepted';
      jobId: string;
    }
  | {
      type: 'job.progress';
      jobId: string;
      state: 'downloading' | 'spooling' | 'printing';
      pagesPrinted?: number;
    }
  | {
      type: 'job.result';
      jobId: string;
      ok: boolean;
      pagesPrinted: number;
      error?: string;
    }
  | {
      type: 'printer.status';
      printerId: string;
      status: PrinterStatus;
      supplies?: Record<string, unknown>;
    }
  | {
      type: 'pong';
      timestamp: number;
    };

export type CloudToAgentMessage =
  | {
      type: 'ack';
      serverTime: number;
      config: {
        heartbeatIntervalMs: number;
        minAgentVersion?: string;
        reprintPolicy?: 'manual';
        printers?: Array<{ id: string; systemName: string }>;
      };
    }
  | {
      type: 'job.dispatch';
      jobId: string;
      fileUrl: string;
      sha256: string;
      settings: PrintSettings;
      printerSystemName: string;
      documentName: string;
      pageCount: number;
    }
  | {
      type: 'ping';
      timestamp: number;
    }
  | {
      type: 'error';
      message: string;
    };

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Human pickup token, e.g. "B-047". Display only; never an auth credential.
 */
export function generatePickupToken(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O (ambiguous)
  const letter = letters.charAt(crypto.randomInt(0, letters.length));
  const num = crypto.randomInt(100, 1000);
  return `${letter}-${num}`;
}

/**
 * Unguessable public token for customer status pages and the SSE stream.
 */
export function generatePublicToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

/** Cryptographically secure 6-digit pairing/OTP code. */
export function generateSixDigitCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}

/**
 * Normalises an Indian phone/WhatsApp id to its 10-digit national number.
 * Accepts: 9876543210, +91 98765 43210, 919876543210, whatsapp:+919...
 */
export function normalizePhone(input: string | null | undefined): string {
  const digits = String(input ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

/** WhatsApp id used by the Cloud API is E.164 digits without '+'. */
export function toWaId(phone: string): string {
  const national = normalizePhone(phone);
  return national.length === 10 ? `91${national}` : national;
}

export function maskPhone(input: string | null | undefined): string {
  const digits = String(input ?? '').replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `******${digits.slice(-4)}`;
}

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Constant-time comparison that never throws on different lengths. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function hmacSha256Hex(secret: string, payload: string | Buffer): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/** Basic E.164 formatting for outbound notifications. */
export function formatE164Indian(phone: string): string {
  const national = normalizePhone(phone);
  return national.length === 10 ? `+91${national}` : phone;
}
