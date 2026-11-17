import pg from 'pg';
import type { DatabaseRepository, ShopRecord, UserRecord, AgentRecord, PrinterRecord, RateCardRecord, OrderRecord, FileRecord, OrderItemRecord, PaymentRecord, PrintJobRecord, WebhookEventRecord, WhatsAppSessionRecord, WhatsAppMessageRecord, OtpCodeRecord, RefreshTokenRecord, CreateShopInput, CreateUserInput } from './types.js';
import { type OrderStatus, type OrderChannel, type PrinterStatus } from '@chhaap/shared';
export * from './types.js';
export declare function defaultShopSettings(options?: Partial<ShopRecord['settings']>): ShopRecord['settings'];
export declare function defaultRateCards(shopId: string, minOrderPaise?: number): RateCardRecord[];
export declare class MemoryDatabase implements DatabaseRepository {
    users: Map<string, UserRecord>;
    shops: Map<string, ShopRecord>;
    shopMembers: Map<string, {
        shopId: string;
        userId: string;
        role: string;
    }>;
    agents: Map<string, AgentRecord>;
    printers: Map<string, PrinterRecord>;
    rateCards: Map<string, RateCardRecord>;
    orders: Map<string, OrderRecord>;
    files: Map<string, FileRecord>;
    orderItems: Map<string, OrderItemRecord>;
    payments: Map<string, PaymentRecord>;
    printJobs: Map<string, PrintJobRecord>;
    events: Array<{
        id: string;
        orderId: string | null;
        shopId: string | null;
        type: string;
        payload: Record<string, unknown>;
        createdAt: string;
    }>;
    webhookEvents: Map<string, WebhookEventRecord>;
    waSessions: Map<string, WhatsAppSessionRecord>;
    waMessages: Map<string, WhatsAppMessageRecord>;
    waStatusEvents: Set<string>;
    waOptouts: Set<string>;
    otpCodes: OtpCodeRecord[];
    refreshTokens: Map<string, RefreshTokenRecord>;
    notifications: Set<string>;
    constructor();
    ping(): Promise<boolean>;
    seedDefaultData(): void;
    addShopMember(shopId: string, userId: string, role?: string): Promise<void>;
    getShopMembers(shopId: string): Promise<Array<{
        shopId: string;
        userId: string;
        role: string;
    }>>;
    getShopBySlug(slug: string): Promise<ShopRecord | undefined>;
    getShopById(id: string): Promise<ShopRecord | undefined>;
    getShopByOwnerId(ownerId: string): Promise<ShopRecord | undefined>;
    getAllShops(): Promise<ShopRecord[]>;
    createShop(input: CreateShopInput): Promise<ShopRecord>;
    updateShop(id: string, updates: Partial<ShopRecord>): Promise<ShopRecord | undefined>;
    getUserByPhone(phone: string): Promise<UserRecord | undefined>;
    getUserById(id: string): Promise<UserRecord | undefined>;
    createUser(input: CreateUserInput): Promise<UserRecord>;
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
    getPendingPrintJobsForShop(shopId: string): Promise<Array<{
        job: PrintJobRecord;
        item: OrderItemRecord;
        file: FileRecord;
        order: OrderRecord;
    }>>;
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
export declare class PostgresDatabase implements DatabaseRepository {
    private pool;
    constructor(connectionString: string);
    close(): Promise<void>;
    query<T extends pg.QueryResultRow = any>(text: string, params?: any[]): Promise<pg.QueryResult<T>>;
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
    getPendingPrintJobsForShop(shopId: string): Promise<Array<{
        job: PrintJobRecord;
        item: OrderItemRecord;
        file: FileRecord;
        order: OrderRecord;
    }>>;
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
export declare function getDatabase(forceType?: 'memory' | 'postgres'): DatabaseRepository;
/** Test helper: forget the singleton so a new DB can be created. */
export declare function resetDatabaseSingleton(): void;
export declare const db: DatabaseRepository;
//# sourceMappingURL=index.d.ts.map