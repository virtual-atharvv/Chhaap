import crypto from 'node:crypto';
import { db, type OrderRecord, type PaymentRecord } from '@chhaap/db';
import { safeEqual } from '@chhaap/shared';
import { gateway } from './websocket-gateway.js';
import { loadConfig } from './config.js';
import { orderNotifier } from './whatsapp/notifier.js';

export interface CheckoutSession {
  razorpayOrderId: string;
  amountPaise: number;
  currency: string;
  keyId: string;
  orderToken: string;
  publicToken: string;
  orderId: string;
}

export interface PaymentLinkSession {
  paymentLinkId: string;
  shortUrl: string;
  amountPaise: number;
  expiresAt: string;
}

interface RazorpayOrderResponse {
  id: string;
  amount: number;
  currency: string;
}

interface RazorpayLinkResponse {
  id: string;
  short_url: string;
  amount: number;
  currency: string;
  expire_by?: number;
}

interface RazorpayRefundResponse {
  id: string;
  status: string;
}

/**
 * All Razorpay interaction lives here. The cardinal rule: money is integer
 * paise, the server computes the amount, and only a verified webhook (or the
 * explicit simulated-payment path in non-production) may mark an order paid.
 */
export class PaymentService {
  private get config() {
    return loadConfig();
  }

  private async razorpayRequest<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    if (this.config.paymentsMode !== 'razorpay') {
      throw new Error('Razorpay API is disabled while PAYMENTS_MODE=simulated');
    }
    if (!this.config.razorpayKeyId || !this.config.razorpayKeySecret) {
      throw new Error('Razorpay credentials are not configured');
    }

    const auth = Buffer.from(
      `${this.config.razorpayKeyId}:${this.config.razorpayKeySecret}`
    ).toString('base64');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`https://api.razorpay.com/v1${path}`, {
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        const message =
          (data as { error?: { description?: string } }).error?.description ||
          `Razorpay HTTP ${res.status}`;
        throw new Error(`Razorpay request failed: ${message}`);
      }
      return data as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Creates (or reuses) a Razorpay order for the web checkout. */
  async createCheckout(orderId: string): Promise<CheckoutSession> {
    const order = await db.getOrderById(orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);

    if (order.totalPaise <= 0) {
      throw new Error('Order total has not been calculated yet');
    }
    if (order.status !== 'draft' && order.status !== 'awaiting_payment') {
      throw new Error(`Order is not eligible for payment (current status: ${order.status})`);
    }

    if (order.status === 'draft') {
      const moved = await db.transitionOrderStatus(order.id, 'awaiting_payment');
      if (!moved.success) throw new Error(moved.error || 'Could not start checkout');
    }

    const existing = await db.getPaymentByOrderId(order.id);
    if (existing && existing.status === 'created' && this.config.paymentsMode === 'simulated') {
      return {
        razorpayOrderId: existing.razorpayOrderId,
        amountPaise: order.totalPaise,
        currency: order.currency,
        keyId: this.config.razorpayKeyId,
        orderToken: order.token,
        publicToken: order.publicToken,
        orderId: order.id
      };
    }

    let razorpayOrderId: string;
    if (this.config.paymentsMode === 'razorpay') {
      const rzpOrder = await this.razorpayRequest<RazorpayOrderResponse>('POST', '/orders', {
        amount: order.totalPaise,
        currency: order.currency,
        receipt: `order_${order.id}`.slice(0, 40),
        notes: { orderId: order.id, shopId: order.shopId }
      });
      if (rzpOrder.amount !== order.totalPaise || rzpOrder.currency !== order.currency) {
        throw new Error('Razorpay returned an amount/currency mismatch');
      }
      razorpayOrderId = rzpOrder.id;
    } else {
      razorpayOrderId = `order_sim_${crypto.randomUUID()}`;
    }

    if (existing) {
      await db.updatePayment(existing.id, {
        razorpayOrderId,
        amountPaise: order.totalPaise,
        status: 'created'
      });
    } else {
      await db.createPayment({
        orderId: order.id,
        razorpayOrderId,
        razorpayPaymentId: null,
        paymentLinkId: null,
        status: 'created',
        method: null,
        amountPaise: order.totalPaise,
        signatureVerified: false,
        raw: null
      });
    }

    return {
      razorpayOrderId,
      amountPaise: order.totalPaise,
      currency: order.currency,
      keyId: this.config.razorpayKeyId,
      orderToken: order.token,
      publicToken: order.publicToken,
      orderId: order.id
    };
  }

  /**
   * Creates (or reuses) a UPI-first Razorpay Payment Link for WhatsApp. The
   * link amount is always the server-computed order total.
   */
  async createPaymentLink(orderId: string): Promise<PaymentLinkSession> {
    const order = await db.getOrderById(orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);
    if (order.totalPaise <= 0) throw new Error('Order total has not been calculated yet');
    if (order.status !== 'draft' && order.status !== 'awaiting_payment') {
      throw new Error(`Order is not eligible for a payment link (status: ${order.status})`);
    }

    if (order.status === 'draft') {
      const moved = await db.transitionOrderStatus(order.id, 'awaiting_payment');
      if (!moved.success) throw new Error(moved.error || 'Could not start payment');
    }

    const ttlMs = this.config.paymentLinkTtlMinutes * 60 * 1000;
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();

    const existing = await db.getPaymentByOrderId(order.id);
    if (existing?.paymentLinkId && existing.status === 'created') {
      const raw = existing.raw as { shortUrl?: string; expiresAt?: string } | null;
      if (raw?.shortUrl && raw.expiresAt && new Date(raw.expiresAt).getTime() > Date.now()) {
        return {
          paymentLinkId: existing.paymentLinkId,
          shortUrl: raw.shortUrl,
          amountPaise: existing.amountPaise,
          expiresAt: raw.expiresAt
        };
      }
    }

    let paymentLinkId: string;
    let shortUrl: string;

    if (this.config.paymentsMode === 'razorpay') {
      const link = await this.razorpayRequest<RazorpayLinkResponse>('POST', '/payment_links', {
        amount: order.totalPaise,
        currency: order.currency,
        accept_partial: false,
        expire_by: Math.floor((Date.now() + ttlMs) / 1000),
        reference_id: order.id,
        description: `Chhaap order ${order.token}`,
        customer: order.customerPhone
          ? { contact: `+91${order.customerPhone}` }
          : undefined,
        notify: { sms: false, email: false },
        reminder_enable: false,
        notes: { orderId: order.id, shopId: order.shopId }
      });
      if (link.amount !== order.totalPaise || link.currency !== order.currency) {
        throw new Error('Razorpay returned a payment-link amount/currency mismatch');
      }
      paymentLinkId = link.id;
      shortUrl = link.short_url;
    } else {
      paymentLinkId = `plink_sim_${crypto.randomUUID()}`;
      shortUrl = `${this.config.publicBaseUrl.replace(/\/$/, '')}/pay/${paymentLinkId}`;
    }

    const paymentData = {
      orderId: order.id,
      razorpayOrderId: existing?.razorpayOrderId ?? `link_${paymentLinkId}`,
      razorpayPaymentId: null,
      paymentLinkId,
      status: 'created',
      method: 'upi_link',
      amountPaise: order.totalPaise,
      signatureVerified: false,
      raw: { shortUrl, expiresAt } as Record<string, unknown>
    };

    if (existing) {
      await db.updatePayment(existing.id, paymentData);
    } else {
      await db.createPayment(paymentData);
    }

    return { paymentLinkId, shortUrl, amountPaise: order.totalPaise, expiresAt };
  }

  /** HMAC-SHA256 verification against the exact raw request bytes. */
  verifyWebhookSignature(rawBody: string | Buffer, signature: string | undefined): boolean {
    if (!signature) return false;
    const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf-8') : rawBody;
    const expected = crypto
      .createHmac('sha256', this.config.razorpayWebhookSecret)
      .update(body)
      .digest('hex');
    return safeEqual(expected.toLowerCase(), signature.toLowerCase());
  }

  /**
   * Handles a verified payment.captured / payment_link.paid event. This is the
   * only production path to `queued`; every step is idempotent so duplicate
   * webhook deliveries cannot double-print or double-charge.
   */
  async handlePaymentCaptured(params: {
    razorpayOrderId?: string;
    paymentLinkId?: string;
    razorpayPaymentId: string;
    amountPaise: number;
    currency?: string;
    method?: string;
    rawPayload?: Record<string, unknown>;
  }): Promise<{ success: boolean; orderId?: string; error?: string; alreadyProcessed?: boolean }> {
    const payment = params.paymentLinkId
      ? await db.getPaymentByPaymentLinkId(params.paymentLinkId)
      : params.razorpayOrderId
        ? await db.getPaymentByRazorpayOrderId(params.razorpayOrderId)
        : undefined;

    if (!payment) return { success: false, error: 'Payment record not found' };

    const order = await db.getOrderById(payment.orderId);
    if (!order) return { success: false, error: 'Order not found' };

    // Re-check the amount and currency against the server-side order.
    if (params.amountPaise !== order.totalPaise || params.amountPaise !== payment.amountPaise) {
      return {
        success: false,
        error: `Payment amount ${params.amountPaise} does not match order amount ${order.totalPaise}`
      };
    }
    if ((params.currency || order.currency).toUpperCase() !== order.currency.toUpperCase()) {
      return { success: false, error: 'Payment currency does not match the order currency' };
    }
    if (order.status === 'expired' || order.status === 'refunded') {
      return { success: false, error: `Order is already ${order.status}` };
    }

    const alreadyPaid =
      payment.status === 'captured' ||
      ['paid', 'queued', 'printing', 'completed'].includes(order.status);
    if (alreadyPaid) {
      return { success: true, orderId: order.id, alreadyProcessed: true };
    }

    if (order.status !== 'awaiting_payment' && order.status !== 'draft') {
      return { success: false, error: `Order is not awaiting payment (status: ${order.status})` };
    }

    await db.updatePayment(payment.id, {
      status: 'captured',
      razorpayPaymentId: params.razorpayPaymentId,
      method: params.method || 'upi',
      signatureVerified: true,
      raw: {
        ...(payment.raw ?? {}),
        ...(params.rawPayload ?? {}),
        paymentMethod: params.method || 'upi'
      }
    });

    if (order.status === 'draft') {
      const started = await db.transitionOrderStatus(order.id, 'awaiting_payment');
      if (!started.success) return { success: false, error: started.error };
    }

    const paid = await db.transitionOrderStatus(order.id, 'paid', {
      paymentId: params.razorpayPaymentId,
      amountPaise: params.amountPaise
    });
    if (!paid.success) {
      if (paid.error?.includes("'paid'")) {
        return { success: true, orderId: order.id, alreadyProcessed: true };
      }
      return { success: false, error: paid.error };
    }

    gateway.notifyOrderStatus(order.id, 'paid');
    await orderNotifier.notifyOrderPaid(paid.order ?? order).catch((err) => {
      console.warn('[Payments] paid notification failed (printing continues):', err);
    });

    // One print job per order item. Duplicate webhook deliveries are stopped
    // before this point, but guard against pre-existing jobs as well.
    const items = await db.getOrderItemsByOrderId(order.id);
    for (const item of items) {
      const existingJobs = await db.getPrintJobsByOrderItemId(item.id);
      if (existingJobs.length === 0) {
        await db.createPrintJob({ orderItemId: item.id, printerId: null, status: 'pending' });
      }
    }

    const queued = await db.transitionOrderStatus(order.id, 'queued');
    if (!queued.success && !queued.error?.includes("'queued'")) {
      return { success: false, error: queued.error };
    }
    gateway.notifyOrderStatus(order.id, 'queued');

    await gateway.dispatchPendingJobsForShop(order.shopId).catch((err) => {
      console.warn('[Payments] dispatch failed; reconciliation will retry:', err);
    });

    return { success: true, orderId: order.id };
  }

  /** Simulated payment is compiled in but gated by config at boot and at call time. */
  async simulateSuccessfulPayment(
    orderId: string,
    publicToken?: string
  ): Promise<{ success: boolean; error?: string }> {
    if (this.config.paymentsMode !== 'simulated' || this.config.nodeEnv === 'production') {
      throw new Error('Simulated payment is disabled');
    }

    const order = await db.getOrderById(orderId);
    if (!order) return { success: false, error: 'Order not found' };
    if (publicToken && order.publicToken !== publicToken) {
      return { success: false, error: 'Invalid order access token' };
    }

    const checkout = await this.createCheckout(orderId);
    return this.handlePaymentCaptured({
      razorpayOrderId: checkout.razorpayOrderId,
      razorpayPaymentId: `pay_sim_${crypto.randomUUID()}`,
      amountPaise: order.totalPaise,
      currency: order.currency,
      method: 'upi_intent',
      rawPayload: { simulated: true }
    });
  }

  /** Simulated completion of a payment link (used by the local /pay page). */
  async simulatePaymentLinkPaid(paymentLinkId: string): Promise<{ success: boolean; orderId?: string; error?: string }> {
    if (this.config.paymentsMode !== 'simulated' || this.config.nodeEnv === 'production') {
      throw new Error('Simulated payment links are disabled');
    }
    const payment = await db.getPaymentByPaymentLinkId(paymentLinkId);
    if (!payment) return { success: false, error: 'Payment link not found' };
    const order = await db.getOrderById(payment.orderId);
    if (!order) return { success: false, error: 'Order not found' };

    return this.handlePaymentCaptured({
      paymentLinkId,
      razorpayPaymentId: `pay_sim_${crypto.randomUUID()}`,
      amountPaise: order.totalPaise,
      currency: order.currency,
      method: 'upi_link',
      rawPayload: { simulated: true, paymentLinkId }
    });
  }

  /**
   * Refunds a captured payment. In live mode this calls Razorpay's refund API;
   * in simulated mode it records the refund locally. Never throws into the
   * print pipeline: callers log and continue.
   */
  async refundOrder(
    orderId: string,
    reason: string
  ): Promise<{ success: boolean; refundId?: string; error?: string }> {
    const order = await db.getOrderById(orderId);
    if (!order) return { success: false, error: 'Order not found' };
    const payment = await db.getPaymentByOrderId(orderId);
    if (!payment) return { success: false, error: 'Payment record not found' };

    try {
      let refundId: string;
      if (this.config.paymentsMode === 'razorpay' && payment.razorpayPaymentId) {
        const refund = await this.razorpayRequest<RazorpayRefundResponse>(
          'POST',
          `/payments/${encodeURIComponent(payment.razorpayPaymentId)}/refund`,
          { amount: payment.amountPaise, notes: { orderId, reason }, speed: 'normal' }
        );
        refundId = refund.id;
      } else {
        refundId = `rfnd_sim_${crypto.randomUUID()}`;
      }

      await db.updatePayment(payment.id, {
        status: 'refunded',
        raw: { ...(payment.raw ?? {}), refundId, refundReason: reason }
      });

      if (order.status === 'failed') {
        await db.transitionOrderStatus(orderId, 'refunded', { refundId, reason });
      } else if (['paid', 'queued', 'printing'].includes(order.status)) {
        await db.transitionOrderStatus(orderId, 'refunded', { refundId, reason });
      } else if (order.status === 'awaiting_payment') {
        await db.transitionOrderStatus(orderId, 'expired', { reason });
      }

      await db.logEvent(orderId, order.shopId, 'payment.refunded', {
        refundId,
        amountPaise: payment.amountPaise,
        reason
      });
      gateway.notifyOrderStatus(orderId, 'refunded', { refundId, reason });
      const updated = await db.getOrderById(orderId);
      if (updated) {
        await orderNotifier.notifyOrderRefunded(updated).catch(() => {});
      }
      return { success: true, refundId };
    } catch (err) {
      const message = (err as Error).message;
      console.error(`[Payments] Refund failed for order ${orderId}:`, message);
      return { success: false, error: message };
    }
  }
}

export const paymentService = new PaymentService();
