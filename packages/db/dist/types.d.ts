import type { OrderStatus, OrderChannel, PrintJobStatus, PrinterStatus, ShopStatus, FileScanStatus, PrintSettings, PrinterCapabilities, RateCardEntry, WaSessionState, WaLanguage, PageClassification } from '@chhaap/shared';
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
        whatsappNumber?: string;
        dailySummaryTime?: string;
        quietHoursStart?: string;
        quietHoursEnd?: string;
        ownerAlertsEnabled?: boolean;
        printerOfflineAlertEnabled?: boolean;
        orderFailedAlertEnabled?: boolean;
        dailySummaryEnabled?: boolean;
        lastSummaryDate?: string | null;
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
    pairingAttempts?: number;
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
    publicToken: string;
    channel: OrderChannel;
    customerPhone: string | null;
    customerEmail: string | null;
    customerWaId: string | null;
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
    orderId: string | null;
    storageKey: string;
    originalName: string;
    mime: string;
    sizeBytes: number;
    sha256: string;
    scanStatus: FileScanStatus;
    convertedPdfKey: string | null;
    previewKeys: string[];
    pageCount: number;
    classification: PageClassification[];
    deleteAfter: string;
    deletedAt: string | null;
    createdAt: string;
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
    paymentLinkId: string | null;
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
export interface WhatsAppSessionRecord {
    id: string;
    waId: string;
    shopId: string;
    state: WaSessionState;
    lang: WaLanguage;
    orderId: string | null;
    context: Record<string, any>;
    lastInboundAt: string;
    expiresAt: string;
    createdAt: string;
}
export interface WhatsAppMessageRecord {
    id: string;
    wamid: string;
    direction: 'in' | 'out';
    waId: string;
    type: string;
    payload: Record<string, any>;
    status: string;
    orderId: string | null;
    createdAt: string;
}
export interface WhatsAppOptoutRecord {
    waId: string;
    createdAt: string;
}
export interface OtpCodeRecord {
    id: string;
    phone: string;
    codeHash: string;
    attempts: number;
    expiresAt: string;
    consumedAt: string | null;
}
export interface RefreshTokenRecord {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: string;
    consumedAt: string | null;
    createdAt: string;
}
export interface CreateShopInput {
    slug: string;
    name: string;
    ownerId: string;
    city?: string;
    phone?: string | null;
    gstNo?: string | null;
    status?: ShopStatus;
    planId?: string;
    settings?: ShopRecord['settings'];
}
export interface CreateUserInput {
    email?: string | null;
    phone?: string | null;
    name: string;
    role?: 'owner' | 'staff' | 'admin';
    passwordHash?: string | null;
}
export interface DatabaseRepository {
    ping(): Promise<boolean>;
    getShopBySlug(slug: string): Promise<ShopRecord | undefined>;
    getShopById(id: string): Promise<ShopRecord | undefined>;
    getShopByOwnerId(ownerId: string): Promise<ShopRecord | undefined>;
    getAllShops(): Promise<ShopRecord[]>;
    createShop(input: CreateShopInput): Promise<ShopRecord>;
    updateShop(id: string, updates: Partial<ShopRecord>): Promise<ShopRecord | undefined>;
    getUserByPhone(phone: string): Promise<UserRecord | undefined>;
    getUserById(id: string): Promise<UserRecord | undefined>;
    createUser(input: CreateUserInput): Promise<UserRecord>;
    addShopMember(shopId: string, userId: string, role?: string): Promise<void>;
    getShopMembers(shopId: string): Promise<Array<{
        shopId: string;
        userId: string;
        role: string;
    }>>;
    getPrintersByShopId(shopId: string): Promise<PrinterRecord[]>;
    getAgentsByShopId(shopId: string): Promise<AgentRecord[]>;
    getAgentById(id: string): Promise<AgentRecord | undefined>;
    getAgentByToken(rawToken: string, pepper?: string): Promise<AgentRecord | undefined>;
    getAgentByPairingCode(code: string, pepper?: string): Promise<AgentRecord | undefined>;
    createAgent(input: {
        shopId: string;
        name: string;
        tokenHash: string;
        pairingCode: string | null;
        pairingCodeExpiresAt: string | null;
        os?: string | null;
    }): Promise<AgentRecord>;
    updateAgent(agentId: string, updates: Partial<AgentRecord>): Promise<AgentRecord | undefined>;
    incrementPairingAttempt(agentId: string): Promise<void>;
    updatePrinterStatus(printerId: string, status: PrinterStatus): Promise<PrinterRecord | undefined>;
    upsertPrintersForAgent(agentId: string, shopId: string, printers: PrinterRecord['capabilities'][]): Promise<void>;
    getRateCardsByShopId(shopId: string): Promise<RateCardRecord[]>;
    saveRateCards(shopId: string, rates: RateCardRecord[]): Promise<void>;
    createOrder(data: {
        shopId: string;
        customerPhone?: string | null;
        customerEmail?: string | null;
        customerWaId?: string | null;
        channel?: OrderChannel;
        idempotencyKey: string;
    }): Promise<OrderRecord>;
    getOrderById(id: string): Promise<OrderRecord | undefined>;
    getOrderByPublicToken(publicToken: string): Promise<OrderRecord | undefined>;
    getOrdersByShopId(shopId: string): Promise<OrderRecord[]>;
    getLastOrderByWaId(waId: string): Promise<OrderRecord | undefined>;
    updateOrderTotals(orderId: string, totals: {
        subtotalPaise: number;
        feePaise: number;
        gstPaise: number;
        totalPaise: number;
    }): Promise<OrderRecord | undefined>;
    transitionOrderStatus(orderId: string, to: OrderStatus, metadata?: Record<string, unknown>): Promise<{
        success: boolean;
        order?: OrderRecord;
        error?: string;
    }>;
    getOrdersAwaitingPaymentExpired(olderThanDate: Date): Promise<OrderRecord[]>;
    addFile(file: Omit<FileRecord, 'id' | 'createdAt'>): Promise<FileRecord>;
    getFileById(id: string): Promise<FileRecord | undefined>;
    updateFile(id: string, updates: Partial<FileRecord>): Promise<FileRecord | undefined>;
    getFilesPendingDeletion(now: Date): Promise<FileRecord[]>;
    markFileDeleted(fileId: string): Promise<boolean>;
    addOrderItem(item: Omit<OrderItemRecord, 'id'>): Promise<OrderItemRecord>;
    getOrderItemById(id: string): Promise<OrderItemRecord | undefined>;
    getOrderItemsByOrderId(orderId: string): Promise<OrderItemRecord[]>;
    updateOrderItem(id: string, updates: Partial<OrderItemRecord>): Promise<OrderItemRecord | undefined>;
    createPayment(payment: Omit<PaymentRecord, 'id' | 'createdAt'>): Promise<PaymentRecord>;
    updatePayment(id: string, updates: Partial<PaymentRecord>): Promise<PaymentRecord | undefined>;
    getPaymentByOrderId(orderId: string): Promise<PaymentRecord | undefined>;
    getPaymentByRazorpayOrderId(rzpOrderId: string): Promise<PaymentRecord | undefined>;
    getPaymentByPaymentLinkId(linkId: string): Promise<PaymentRecord | undefined>;
    recordWebhookEvent(provider: string, eventId: string, payload: Record<string, unknown>): Promise<boolean>;
    createPrintJob(data: Omit<PrintJobRecord, 'id' | 'createdAt' | 'attempts' | 'lastError' | 'dispatchedAt' | 'finishedAt'>): Promise<PrintJobRecord>;
    getPrintJobById(id: string): Promise<PrintJobRecord | undefined>;
    getPrintJobsByOrderItemId(orderItemId: string): Promise<PrintJobRecord[]>;
    getPendingPrintJobsForShop(shopId: string): Promise<{
        job: PrintJobRecord;
        item: OrderItemRecord;
        file: FileRecord;
        order: OrderRecord;
    }[]>;
    updatePrintJob(id: string, updates: Partial<PrintJobRecord>): Promise<PrintJobRecord | undefined>;
    getActiveWaSession(waId: string): Promise<WhatsAppSessionRecord | undefined>;
    getWaSessionByOrderId(orderId: string): Promise<WhatsAppSessionRecord | undefined>;
    saveWaSession(session: WhatsAppSessionRecord): Promise<void>;
    expireInactiveWaSessions(now: Date): Promise<WhatsAppSessionRecord[]>;
    recordWaMessage(message: Omit<WhatsAppMessageRecord, 'id' | 'createdAt'>): Promise<WhatsAppMessageRecord>;
    isWaMessageProcessed(wamid: string): Promise<boolean>;
    updateWaMessageStatus(wamid: string, status: string): Promise<void>;
    recordWaStatus(wamid: string, status: string): Promise<boolean>;
    purgeOldWaMessages(before: Date): Promise<number>;
    isOptedOut(waId: string): Promise<boolean>;
    setOptOut(waId: string): Promise<void>;
    clearOptOut(waId: string): Promise<void>;
    createOtp(phone: string, code: string, pepper?: string): Promise<{
        id: string;
        expiresAt: Date;
    }>;
    verifyOtp(phone: string, code: string, pepper?: string): Promise<{
        valid: boolean;
        error?: string;
    }>;
    createRefreshToken(userId: string, token: string, pepper?: string, ttlSeconds?: number): Promise<{
        id: string;
        expiresAt: Date;
    }>;
    consumeRefreshToken(token: string, pepper?: string): Promise<{
        valid: boolean;
        userId?: string;
        error?: string;
    }>;
    recordNotification(orderId: string, event: string): Promise<boolean>;
    logEvent(orderId: string | null, shopId: string | null, type: string, payload: Record<string, unknown>): Promise<void>;
}
//# sourceMappingURL=types.d.ts.map