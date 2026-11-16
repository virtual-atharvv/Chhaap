import type { FastifyPluginAsync } from 'fastify';
import { db } from '@chhaap/db';
import { paymentService } from '../payments.js';
import { loadConfig } from '../config.js';

interface RazorpayWebhook {
  event?: string;
  created_at?: number;
  payload?: {
    payment?: { entity?: Record<string, any> };
    payment_link?: { entity?: Record<string, any> };
    order?: { entity?: Record<string, any> };
    refund?: { entity?: Record<string, any> };
  };
}

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  const config = loadConfig();

  app.post('/v1/webhooks/razorpay', async (req, reply) => {
    const rawBody = (req as any).rawBody as Buffer | string | undefined;
    if (!rawBody) return reply.code(400).send({ error: 'Raw body unavailable' });

    const signature = req.headers['x-razorpay-signature'] as string | undefined;
    if (!paymentService.verifyWebhookSignature(rawBody, signature)) {
      return reply.code(400).send({ error: 'Invalid webhook signature' });
    }

    let payload: RazorpayWebhook;
    try {
      payload = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8'));
    } catch {
      return reply.code(400).send({ error: 'Invalid JSON payload' });
    }

    if (payload.created_at) {
      const ageSeconds = Math.floor(Date.now() / 1000) - payload.created_at;
      if (ageSeconds > config.webhookMaxAgeSeconds) {
        return reply.code(400).send({ error: 'Stale webhook event rejected' });
      }
    }

    const headerEventId = req.headers['x-razorpay-event-id'] as string | undefined;
    const entityId =
      payload.payload?.payment?.entity?.id ??
      payload.payload?.payment_link?.entity?.id ??
      payload.payload?.refund?.entity?.id;
    const eventId =
      headerEventId ?? `evt:${payload.event ?? 'unknown'}:${entityId ?? 'no-entity'}`;

    try {
      if (payload.event === 'payment.captured' || payload.event === 'order.paid') {
        const payment = payload.payload?.payment?.entity;
        if (!payment) return reply.code(400).send({ error: 'Missing payment entity' });

        const result = await paymentService.handlePaymentCaptured({
          razorpayOrderId: payment.order_id,
          razorpayPaymentId: payment.id,
          amountPaise: payment.amount,
          currency: payment.currency,
          method: payment.method,
          rawPayload: payload as Record<string, unknown>
        });
        if (!result.success) return reply.code(400).send({ error: result.error });
      } else if (payload.event === 'payment_link.paid') {
        const link = payload.payload?.payment_link?.entity;
        const payment = payload.payload?.payment?.entity;
        if (!link) return reply.code(400).send({ error: 'Missing payment_link entity' });

        const result = await paymentService.handlePaymentCaptured({
          paymentLinkId: link.id,
          razorpayPaymentId: payment?.id ?? link.payment_id ?? `link_${link.id}`,
          amountPaise: link.amount_paid ?? link.amount,
          currency: link.currency,
          method: payment?.method ?? 'upi_link',
          rawPayload: payload as Record<string, unknown>
        });
        if (!result.success) return reply.code(400).send({ error: result.error });
      } else if (payload.event === 'payment.failed') {
        const payment = payload.payload?.payment?.entity;
        if (payment?.order_id) {
          const record = await db.getPaymentByRazorpayOrderId(payment.order_id);
          if (record) {
            await db.updatePayment(record.id, {
              status: 'failed',
              raw: { ...(record.raw ?? {}), failure: payload as Record<string, unknown> }
            });
          }
        }
      } else {
        // Unknown event types are acknowledged (Meta/Razorpay send many event
        // families) but never alter order state.
        await db.logEvent(null, null, 'razorpay.webhook.ignored', {
          event: payload.event ?? 'unknown'
        });
      }
    } catch (err) {
      console.error('[Razorpay Webhook] Processing error:', err);
      return reply.code(500).send({ error: 'Webhook processing failed' });
    }

    // Record only after the handler succeeds. The unique DB constraint makes
    // concurrent duplicate deliveries collapse to one processing effect.
    const isNew = await db.recordWebhookEvent(
      'razorpay',
      eventId,
      (payload ?? {}) as Record<string, unknown>
    );
    return reply.code(200).send({ status: isNew ? 'ok' : 'already_processed' });
  });
};
