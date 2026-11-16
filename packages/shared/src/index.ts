import { z } from 'zod';

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

// ============================================================================
// ORDER STATE MACHINE
// ============================================================================

const ALLOWED_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ['awaiting_payment', 'expired'],
  awaiting_payment: ['paid', 'expired'],
  paid: ['queued', 'refunded'],
  queued: ['printing', 'failed', 'refunded'],
  printing: ['completed', 'failed'],
  completed: [],
  failed: ['queued', 'refunded'], // Allow up to 3 retries back to queued
  refunded: [],
  expired: []
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  const allowed = ALLOWED_ORDER_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

// ============================================================================
// ZOD SCHEMAS & TYPES
// ============================================================================

export const PrintSettingsSchema = z.object({
  copies: z.number().int().min(1).max(500).default(1),
  paperSize: z.enum(PAPER_SIZES).default('A4'),
  colorMode: z.enum(COLOR_MODES).default('bw'),
  sides: z.enum(SIDES_OPTIONS).default('single'),
  pagesPerSheet: z.number().refine((val): val is PagesPerSheet => PAGES_PER_SHEET.includes(val as PagesPerSheet), {
    message: 'Must be 1, 2, 4, 6, or 9'
  }).default(1),
  orientation: z.enum(ORIENTATIONS).default('auto'),
  fitMode: z.enum(FIT_MODES).default('fit'),
  pageRange: z.string().optional() // e.g. "1-5, 8, 11-13" or empty for all
});
export type PrintSettings = z.infer<typeof PrintSettingsSchema>;

export const PrinterCapabilitiesSchema = z.object({
  systemName: z.string(),
  displayName: z.string(),
  color: z.boolean(),
  duplex: z.boolean(),
  papers: z.array(z.string()),
  dpi: z.number().optional()
});
export type PrinterCapabilities = z.infer<typeof PrinterCapabilitiesSchema>;

export const RateCardEntrySchema = z.object({
  paperSize: z.enum(PAPER_SIZES),
  colorMode: z.enum(['bw', 'color']),
  sides: z.enum(SIDES_OPTIONS),
  pricePerPagePaise: z.number().int().min(0)
});
export type RateCardEntry = z.infer<typeof RateCardEntrySchema>;

export const ShopPricingConfigSchema = z.object({
  minOrderPaise: z.number().int().min(0).default(500), // Default min ₹5
  platformConvenienceFeePaise: z.number().int().min(0).default(100), // Default ₹1
  gstRatePercent: z.number().min(0).max(100).default(0), // 0% by default for small shops
  rates: z.array(RateCardEntrySchema)
});
export type ShopPricingConfig = z.infer<typeof ShopPricingConfigSchema>;

// Order creation input
export const CreateDraftOrderSchema = z.object({
  shopSlug: z.string(),
  customerPhone: z.string().regex(/^[6-9]\d{9}$/, 'Invalid 10-digit Indian phone number').optional(),
  customerEmail: z.string().email().optional(),
  idempotencyKey: z.string().min(8)
});
export type CreateDraftOrderInput = z.infer<typeof CreateDraftOrderSchema>;

// Update order item settings input
export const UpdateOrderItemSettingsSchema = z.object({
  settings: PrintSettingsSchema
});
export type UpdateOrderItemSettingsInput = z.infer<typeof UpdateOrderItemSettingsSchema>;

// Agent Pairing Input
export const AgentPairingRequestSchema = z.object({
  pairingCode: z.string().length(6),
  agentName: z.string().default('Shop PC Agent'),
  os: z.string().default('linux')
});
export type AgentPairingRequest = z.infer<typeof AgentPairingRequestSchema>;

// ============================================================================
// WEBSOCKET AGENT PROTOCOL
// ============================================================================

export type AgentToCloudMessage =
  | {
      type: 'hello';
      agentId: string;
      token: string;
      version: string;
      os: string;
      printers: PrinterCapabilities[];
      unfinishedJobIds?: string[];
    }
  | {
      type: 'job.accepted';
      jobId: string;
    }
  | {
      type: 'job.progress';
      jobId: string;
      state: 'spooling' | 'printing';
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
    }
  | {
      type: 'ping';
      timestamp: number;
    }
  | {
      type: 'error';
      message: string;
    };

// Human pickup token generator e.g. "B-047"
export function generatePickupToken(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const letter = letters.charAt(Math.floor(Math.random() * letters.length));
  const num = Math.floor(100 + Math.random() * 900);
  return `${letter}-${num}`;
}
