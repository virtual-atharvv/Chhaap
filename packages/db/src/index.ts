import crypto from 'node:crypto';
import type {
  ShopRecord,
  UserRecord,
  AgentRecord,
  PrinterRecord,
  RateCardRecord,
  OrderRecord,
  FileRecord,
  OrderItemRecord,
  PaymentRecord,
  PrintJobRecord,
  EventRecord,
  WebhookEventRecord
} from './types.js';
import {
  canTransitionOrder,
  generatePickupToken,
  type OrderStatus,
  type PrintJobStatus,
  type PrinterStatus,
  type PrintSettings
} from '@chhaap/shared';

export * from './types.js';

export class MemoryDatabase {
  users = new Map<string, UserRecord>();
  shops = new Map<string, ShopRecord>();
  agents = new Map<string, AgentRecord>();
  printers = new Map<string, PrinterRecord>();
  rateCards = new Map<string, RateCardRecord>();
  orders = new Map<string, OrderRecord>();
  files = new Map<string, FileRecord>();
  orderItems = new Map<string, OrderItemRecord>();
  payments = new Map<string, PaymentRecord>();
  printJobs = new Map<string, PrintJobRecord>();
  events: EventRecord[] = [];
  webhookEvents = new Map<string, WebhookEventRecord>();

  constructor() {
    this.seedDefaultData();
  }

  seedDefaultData() {
    // 1. Default user / shop owner
    const ownerId = 'user-owner-1';
    this.users.set(ownerId, {
      id: ownerId,
      email: 'owner@campusxerox.in',
      phone: '9876543210',
      name: 'Ramesh Sharma',
      role: 'owner',
      passwordHash: 'seeded_dummy_hash',
      createdAt: new Date().toISOString()
    });

    // 2. Default beachhead shop in Lucknow
    const shopId = 'shop-campus-xerox';
    this.shops.set(shopId, {
      id: shopId,
      slug: 'campus-xerox',
      name: 'Campus Xerox & Stationary',
      ownerId,
      city: 'Lucknow',
      phone: '9876543210',
      gstNo: null,
      status: 'active',
      planId: 'starter',
      settings: {
        minOrderPaise: 500, // ₹5 min order
        platformConvenienceFeePaise: 100, // ₹1 fee
        gstRatePercent: 0,
        isOpen: true,
        upiVpa: 'campusxerox@upi'
      },
      createdAt: new Date().toISOString()
    });

    // 3. Default agent (paired with a token)
    const agentId = 'agent-campus-1';
    const rawToken = 'test_agent_secret_token_123';
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    this.agents.set(agentId, {
      id: agentId,
      shopId,
      name: 'Shop PC Front Desk',
      tokenHash,
      pairingCode: '123456',
      pairingCodeExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      version: '0.1.0',
      lastSeenAt: new Date().toISOString(),
      os: 'linux',
      status: 'online',
      createdAt: new Date().toISOString()
    });

    // 4. Default Virtual / CUPS-PDF printer
    const printerId = 'printer-cups-pdf';
    this.printers.set(printerId, {
      id: printerId,
      shopId,
      agentId,
      systemName: 'PDF',
      displayName: 'Virtual CUPS-PDF (A4/A3 Mono & Colour)',
      capabilities: {
        systemName: 'PDF',
        displayName: 'Virtual CUPS-PDF (A4/A3 Mono & Colour)',
        color: true,
        duplex: true,
        papers: ['A4', 'A3', 'Legal'],
        dpi: 600
      },
      status: 'online',
      lastStatusAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    });

    // 5. Default Rate Cards (Standard Indian Shop rates)
    const rates: Omit<RateCardRecord, 'id' | 'shopId' | 'printerId' | 'minOrderPaise'>[] = [
      { paperSize: 'A4', colorMode: 'bw', sides: 'single', pricePerPagePaise: 200 },
      { paperSize: 'A4', colorMode: 'bw', sides: 'duplex', pricePerPagePaise: 150 },
      { paperSize: 'A4', colorMode: 'color', sides: 'single', pricePerPagePaise: 1000 },
      { paperSize: 'A4', colorMode: 'color', sides: 'duplex', pricePerPagePaise: 800 },
      { paperSize: 'A3', colorMode: 'bw', sides: 'single', pricePerPagePaise: 1000 },
      { paperSize: 'A3', colorMode: 'bw', sides: 'duplex', pricePerPagePaise: 800 },
      { paperSize: 'A3', colorMode: 'color', sides: 'single', pricePerPagePaise: 3000 },
      { paperSize: 'A3', colorMode: 'color', sides: 'duplex', pricePerPagePaise: 2500 }
    ];

    for (const r of rates) {
      const id = `rate-${r.paperSize}-${r.colorMode}-${r.sides}`;
      this.rateCards.set(id, {
        id,
        shopId,
        printerId: null,
        minOrderPaise: 500,
        ...r
      });
    }
  }

  // --- Shops ---
  getShopBySlug(slug: string): ShopRecord | undefined {
    for (const shop of this.shops.values()) {
      if (shop.slug === slug) return shop;
    }
    return undefined;
  }

  getShopById(id: string): ShopRecord | undefined {
    return this.shops.get(id);
  }

  // --- Printers & Agents ---
  getPrintersByShopId(shopId: string): PrinterRecord[] {
    return Array.from(this.printers.values()).filter((p) => p.shopId === shopId);
  }

  getAgentById(id: string): AgentRecord | undefined {
    return this.agents.get(id);
  }

  getAgentByToken(rawToken: string): AgentRecord | undefined {
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
    for (const agent of this.agents.values()) {
      if (agent.tokenHash === hash) return agent;
    }
    return undefined;
  }

  getAgentByPairingCode(code: string): AgentRecord | undefined {
    const now = new Date().toISOString();
    for (const agent of this.agents.values()) {
      if (agent.pairingCode === code && (!agent.pairingCodeExpiresAt || agent.pairingCodeExpiresAt > now)) {
        return agent;
      }
    }
    return undefined;
  }

  updateAgent(agentId: string, updates: Partial<AgentRecord>): AgentRecord | undefined {
    const agent = this.agents.get(agentId);
    if (!agent) return undefined;
    const updated = { ...agent, ...updates };
    this.agents.set(agentId, updated);
    return updated;
  }

  updatePrinterStatus(printerId: string, status: PrinterStatus): PrinterRecord | undefined {
    const printer = this.printers.get(printerId);
    if (!printer) return undefined;
    printer.status = status;
    printer.lastStatusAt = new Date().toISOString();
    this.printers.set(printerId, printer);
    return printer;
  }

  upsertPrintersForAgent(agentId: string, shopId: string, printers: PrinterRecord['capabilities'][]) {
    for (const cap of printers) {
      let existing: PrinterRecord | undefined;
      for (const p of this.printers.values()) {
        if (p.agentId === agentId && p.systemName === cap.systemName) {
          existing = p;
          break;
        }
      }
      if (existing) {
        existing.capabilities = cap;
        existing.displayName = cap.displayName;
        existing.status = 'online';
        existing.lastStatusAt = new Date().toISOString();
      } else {
        const id = `printer-${crypto.randomUUID()}`;
        this.printers.set(id, {
          id,
          shopId,
          agentId,
          systemName: cap.systemName,
          displayName: cap.displayName,
          capabilities: cap,
          status: 'online',
          lastStatusAt: new Date().toISOString(),
          createdAt: new Date().toISOString()
        });
      }
    }
  }

  // --- Rate Cards ---
  getRateCardsByShopId(shopId: string): RateCardRecord[] {
    return Array.from(this.rateCards.values()).filter((r) => r.shopId === shopId);
  }

  // --- Orders ---
  createOrder(data: {
    shopId: string;
    customerPhone?: string;
    customerEmail?: string;
    idempotencyKey: string;
  }): OrderRecord {
    // Check idempotency
    for (const ord of this.orders.values()) {
      if (ord.idempotencyKey === data.idempotencyKey) {
        return ord;
      }
    }

    const id = crypto.randomUUID();
    const token = generatePickupToken();
    const order: OrderRecord = {
      id,
      shopId: data.shopId,
      token,
      customerPhone: data.customerPhone || null,
      customerEmail: data.customerEmail || null,
      status: 'draft',
      subtotalPaise: 0,
      feePaise: 100,
      gstPaise: 0,
      totalPaise: 0,
      currency: 'INR',
      idempotencyKey: data.idempotencyKey,
      createdAt: new Date().toISOString(),
      paidAt: null,
      completedAt: null,
      expiresAt: new Date(Date.now() + 3600000).toISOString()
    };

    this.orders.set(id, order);
    this.logEvent(id, data.shopId, 'order.created', { orderId: id, token });
    return order;
  }

  getOrderById(id: string): OrderRecord | undefined {
    return this.orders.get(id);
  }

  getOrdersByShopId(shopId: string): OrderRecord[] {
    return Array.from(this.orders.values())
      .filter((o) => o.shopId === shopId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Safe optimistic transition with state machine validation
   */
  transitionOrderStatus(
    orderId: string,
    to: OrderStatus,
    metadata?: Record<string, unknown>
  ): { success: boolean; order?: OrderRecord; error?: string } {
    const order = this.orders.get(orderId);
    if (!order) {
      return { success: false, error: 'Order not found' };
    }

    if (!canTransitionOrder(order.status, to)) {
      return {
        success: false,
        error: `Cannot transition order from '${order.status}' to '${to}'`
      };
    }

    order.status = to;
    if (to === 'paid') {
      order.paidAt = new Date().toISOString();
    } else if (to === 'completed') {
      order.completedAt = new Date().toISOString();
    }

    this.orders.set(orderId, order);
    this.logEvent(orderId, order.shopId, `order.status.${to}`, {
      orderId,
      previousStatus: order.status,
      newStatus: to,
      ...metadata
    });

    return { success: true, order };
  }

  // --- Files & Order Items ---
  addFile(file: Omit<FileRecord, 'id' | 'createdAt'>): FileRecord {
    const id = crypto.randomUUID();
    const record: FileRecord = {
      id,
      ...file
    };
    this.files.set(id, record);
    return record;
  }

  getFileById(id: string): FileRecord | undefined {
    return this.files.get(id);
  }

  addOrderItem(item: Omit<OrderItemRecord, 'id'>): OrderItemRecord {
    const id = crypto.randomUUID();
    const record: OrderItemRecord = {
      id,
      ...item
    };
    this.orderItems.set(id, record);
    return record;
  }

  getOrderItemsByOrderId(orderId: string): OrderItemRecord[] {
    return Array.from(this.orderItems.values()).filter((i) => i.orderId === orderId);
  }

  updateOrderItem(id: string, updates: Partial<OrderItemRecord>): OrderItemRecord | undefined {
    const item = this.orderItems.get(id);
    if (!item) return undefined;
    const updated = { ...item, ...updates };
    this.orderItems.set(id, updated);
    return updated;
  }

  // --- Payments ---
  createPayment(payment: Omit<PaymentRecord, 'id' | 'createdAt'>): PaymentRecord {
    const id = crypto.randomUUID();
    const record: PaymentRecord = {
      id,
      ...payment,
      createdAt: new Date().toISOString()
    };
    this.payments.set(id, record);
    return record;
  }

  getPaymentByOrderId(orderId: string): PaymentRecord | undefined {
    for (const p of this.payments.values()) {
      if (p.orderId === orderId) return p;
    }
    return undefined;
  }

  getPaymentByRazorpayOrderId(rzpOrderId: string): PaymentRecord | undefined {
    for (const p of this.payments.values()) {
      if (p.razorpayOrderId === rzpOrderId) return p;
    }
    return undefined;
  }

  // --- Webhook Events Deduplication ---
  recordWebhookEvent(provider: string, eventId: string, payload: Record<string, unknown>): boolean {
    const key = `${provider}:${eventId}`;
    if (this.webhookEvents.has(key)) {
      return false; // Already processed!
    }
    this.webhookEvents.set(key, {
      id: crypto.randomUUID(),
      provider,
      eventId,
      payload,
      processedAt: new Date().toISOString()
    });
    return true;
  }

  // --- Print Jobs ---
  createPrintJob(data: Omit<PrintJobRecord, 'id' | 'createdAt' | 'attempts' | 'lastError' | 'dispatchedAt' | 'finishedAt'>): PrintJobRecord {
    const id = crypto.randomUUID();
    const record: PrintJobRecord = {
      id,
      ...data,
      attempts: 0,
      lastError: null,
      dispatchedAt: null,
      finishedAt: null,
      createdAt: new Date().toISOString()
    };
    this.printJobs.set(id, record);
    return record;
  }

  getPrintJobById(id: string): PrintJobRecord | undefined {
    return this.printJobs.get(id);
  }

  getPendingPrintJobsForShop(shopId: string): { job: PrintJobRecord; item: OrderItemRecord; file: FileRecord; order: OrderRecord }[] {
    const results: { job: PrintJobRecord; item: OrderItemRecord; file: FileRecord; order: OrderRecord }[] = [];
    for (const job of this.printJobs.values()) {
      if (job.status === 'pending' || job.status === 'dispatched') {
        const item = this.orderItems.get(job.orderItemId);
        if (!item) continue;
        const order = this.orders.get(item.orderId);
        if (!order || order.shopId !== shopId) continue;
        const file = this.files.get(item.fileId);
        if (!file) continue;
        results.push({ job, item, file, order });
      }
    }
    return results;
  }

  updatePrintJob(id: string, updates: Partial<PrintJobRecord>): PrintJobRecord | undefined {
    const job = this.printJobs.get(id);
    if (!job) return undefined;
    const updated = { ...job, ...updates };
    this.printJobs.set(id, updated);
    return updated;
  }

  // --- Audit Events ---
  logEvent(orderId: string | null, shopId: string | null, type: string, payload: Record<string, unknown>) {
    this.events.push({
      id: crypto.randomUUID(),
      orderId,
      shopId,
      type,
      payload,
      createdAt: new Date().toISOString()
    });
  }
}

// Global DB instance
export const db = new MemoryDatabase();
