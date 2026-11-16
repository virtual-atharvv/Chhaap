import crypto from 'node:crypto';
import { db } from '@chhaap/db';
import { gateway } from './websocket-gateway.js';

export class PaymentService {
  private webhookSecret: string;
  private keyId: string;
  private keySecret: string;

  constructor() {
    this.webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'rzp_test_webhook_secret_key_123';
    this.keyId = process.env.RAZORPAY_KEY_ID || 'rzp_test_dummy_key_id';
    this.keySecret = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_dummy_key_secret';
  }

  /**
   * Creates a checkout session / order for Razorpay
   */
  async createCheckout(orderId: string): Promise<{
    razorpayOrderId: string;
    amountPaise: number;
    currency: string;
    keyId: string;
    orderToken: string;
  }> {
    const order = db.getOrderById(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    if (order.status !== 'draft' && order.status !== 'awaiting_payment') {
      throw new Error(`Order is not eligible for payment (current status: ${order.status})`);
    }

    // Ensure order is in awaiting_payment
    if (order.status === 'draft') {
      db.transitionOrderStatus(order.id, 'awaiting_payment');
    }

    const rzpOrderId = `order_${order.id.replace(/-/g, '').slice(0, 14)}`;

    // Persist payment attempt record
    db.createPayment({
      orderId: order.id,
      razorpayOrderId: rzpOrderId,
      razorpayPaymentId: null,
      status: 'created',
      method: null,
      amountPaise: order.totalPaise,
      signatureVerified: false,
      raw: null
    });

    return {
      razorpayOrderId: rzpOrderId,
      amountPaise: order.totalPaise,
      currency: 'INR',
      keyId: this.keyId,
      orderToken: order.token
    };
  }

  /**
   * Verifies Razorpay HMAC SHA256 signature on raw request body
   */
  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    if (!signature) return false;
    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  /**
   * Handles payment captured event and enforces pay-before-print invariant
   */
  async handlePaymentCaptured(params: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    amountPaise: number;
    method?: string;
    rawPayload?: Record<string, unknown>;
  }): Promise<{ success: boolean; orderId?: string; error?: string }> {
    const payment = db.getPaymentByRazorpayOrderId(params.razorpayOrderId);
    if (!payment) {
      return { success: false, error: 'Payment record not found for Razorpay Order ID' };
    }

    const order = db.getOrderById(payment.orderId);
    if (!order) {
      return { success: false, error: 'Order not found' };
    }

    // Update payment record
    payment.status = 'captured';
    payment.razorpayPaymentId = params.razorpayPaymentId;
    payment.method = params.method || 'upi';
    payment.signatureVerified = true;
    payment.raw = params.rawPayload || null;

    // Idempotent order state transition: awaiting_payment -> paid -> queued
    if (order.status === 'awaiting_payment' || order.status === 'draft') {
      const resPaid = db.transitionOrderStatus(order.id, 'paid', {
        paymentId: params.razorpayPaymentId,
        amount: params.amountPaise
      });

      if (!resPaid.success) {
        return { success: false, error: resPaid.error };
      }

      gateway.notifyOrderStatus(order.id, 'paid');

      // Create print jobs for order items
      const items = db.getOrderItemsByOrderId(order.id);
      for (const item of items) {
        db.createPrintJob({
          orderItemId: item.id,
          printerId: null,
          status: 'pending'
        });
      }

      // Transition to queued
      const resQueued = db.transitionOrderStatus(order.id, 'queued');
      if (resQueued.success) {
        gateway.notifyOrderStatus(order.id, 'queued');
      }

      // Dispatch to agent over WebSocket immediately!
      await gateway.dispatchPendingJobsForShop(order.shopId);

      return { success: true, orderId: order.id };
    }

    return { success: true, orderId: order.id };
  }

  /**
   * Test payment simulation for walking skeleton & local dev testing
   */
  async simulateSuccessfulPayment(orderId: string): Promise<{ success: boolean; error?: string }> {
    const order = db.getOrderById(orderId);
    if (!order) return { success: false, error: 'Order not found' };

    const checkout = await this.createCheckout(orderId);
    return await this.handlePaymentCaptured({
      razorpayOrderId: checkout.razorpayOrderId,
      razorpayPaymentId: `pay_sim_${Date.now()}`,
      amountPaise: order.totalPaise,
      method: 'upi_intent',
      rawPayload: { simulated: true }
    });
  }
}

export const paymentService = new PaymentService();
