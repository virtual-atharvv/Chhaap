import type {
  OrderStatus,
  PrintJobStatus,
  PrinterStatus,
  ShopStatus,
  FileScanStatus,
  PaperSize,
  Sides,
  PrintSettings,
  PrinterCapabilities,
  RateCardEntry
} from '@chhaap/shared';

export interface UserRecord {
  id: string;
  email: string | null;
  phone: string | null;
  name: string;
  role: 'owner' | 'staff' | 'admin';
  passwordHash: string | null;
  createdAt: string;
}

export interface ShopRecord {
  id: string;
  slug: string;
  name: string;
  ownerId: string | null;
  city: string;
  phone: string | null;
  gstNo: string | null;
  status: ShopStatus;
  planId: string;
  settings: {
    minOrderPaise?: number;
    platformConvenienceFeePaise?: number;
    gstRatePercent?: number;
    isOpen?: boolean;
    upiVpa?: string;
  };
  createdAt: string;
}

export interface AgentRecord {
  id: string;
  shopId: string;
  name: string;
  tokenHash: string;
  pairingCode: string | null;
  pairingCodeExpiresAt: string | null;
  version: string | null;
  lastSeenAt: string | null;
  os: string | null;
  status: 'online' | 'offline';
  createdAt: string;
}

export interface PrinterRecord {
  id: string;
  shopId: string;
  agentId: string | null;
  systemName: string;
  displayName: string;
  capabilities: PrinterCapabilities;
  status: PrinterStatus;
  lastStatusAt: string;
  createdAt: string;
}

export interface RateCardRecord extends RateCardEntry {
  id: string;
  shopId: string;
  printerId: string | null;
  minOrderPaise: number;
}

export interface OrderRecord {
  id: string;
  shopId: string;
  token: string;
  customerPhone: string | null;
  customerEmail: string | null;
  status: OrderStatus;
  subtotalPaise: number;
  feePaise: number;
  gstPaise: number;
  totalPaise: number;
  currency: string;
  idempotencyKey: string;
  createdAt: string;
  paidAt: string | null;
  completedAt: string | null;
  expiresAt: string;
}

export interface FileRecord {
  id: string;
  orderId: string;
  storageKey: string;
  originalName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  scanStatus: FileScanStatus;
  convertedPdfKey: string | null;
  previewKeys: string[];
  deleteAfter: string;
  deletedAt: string | null;
}

export interface OrderItemRecord {
  id: string;
  orderId: string;
  fileId: string;
  settings: PrintSettings;
  pageCount: number;
  colourPages: number;
  bwPages: number;
  sheets: number;
  lineTotalPaise: number;
  printerId: string | null;
}

export interface PaymentRecord {
  id: string;
  orderId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  status: string;
  method: string | null;
  amountPaise: number;
  signatureVerified: boolean;
  raw: Record<string, unknown> | null;
  createdAt: string;
}

export interface PrintJobRecord {
  id: string;
  orderItemId: string;
  printerId: string | null;
  status: PrintJobStatus;
  attempts: number;
  lastError: string | null;
  dispatchedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface EventRecord {
  id: string;
  orderId: string | null;
  shopId: string | null;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface WebhookEventRecord {
  id: string;
  provider: string;
  eventId: string;
  payload: Record<string, unknown>;
  processedAt: string;
}
