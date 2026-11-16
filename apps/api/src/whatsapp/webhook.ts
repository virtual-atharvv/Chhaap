import crypto from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { DatabaseRepository } from '@chhaap/db';
import { db } from '@chhaap/db';
import { safeEqual } from '@chhaap/shared';
import { loadConfig } from '../config.js';
import { conversationManager } from './conversation.js';
import { shopOwnerAlerts } from './owner-alerts.js';
import { getWhatsAppProvider } from './index.js';
import { limiters } from '../rate-limit.js';

interface WhatsAppWebhookBody {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
        messages?: Array<Record<string, any>>;
        statuses?: Array<Record<string, any>>;
      };
    }>;
  }>;
}

export class WhatsAppWebhookHandler {
  private processing = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  private database: DatabaseRepository = db;

  /** Test seam: lets tests swap the repository without rebuilding module state. */
  setDatabase(database: DatabaseRepository): void {
    this.database = database;
  }

  handleVerification(req: FastifyRequest, reply: FastifyReply) {
    const query = req.query as Record<string, string>;
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    const expected = loadConfig().whatsappVerifyToken;

    if (mode === 'subscribe' && token && safeEqual(token, expected)) {
      return reply.code(200).type('text/plain').send(String(challenge ?? ''));
    }
    return reply.code(403).send('Verification token mismatch');
  }

  /** Verifies X-Hub-Signature-256 over the exact raw request bytes. */
  verifySignature(rawBody: string | Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
    const signature = signatureHeader.slice('sha256='.length);
    const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf-8') : rawBody;
    const expected = crypto
      .createHmac('sha256', loadConfig().whatsappAppSecret)
      .update(body)
      .digest('hex');
    return safeEqual(expected.toLowerCase(), signature.toLowerCase());
  }

  /**
   * Meta requires a fast acknowledgement. We verify, acknowledge with 200 and
   * process the payload on a serial queue. Tests can await `waitForIdle()`.
   */
  async handleInbound(req: FastifyRequest, reply: FastifyReply) {
    const rawBody = (req as any).rawBody as Buffer | string | undefined;
    if (!rawBody) {
      return reply.code(400).send({ error: 'Raw body unavailable' });
    }
    const signatureHeader = req.headers['x-hub-signature-256'] as string | undefined;
    if (!this.verifySignature(rawBody, signatureHeader)) {
      return reply.code(401).send({ error: 'Invalid webhook signature' });
    }

    let body: WhatsAppWebhookBody;
    try {
      body = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8'));
    } catch {
      return reply.code(400).send({ error: 'Invalid JSON' });
    }

    reply.code(200).send({ status: 'ok' });
    this.queue = this.queue
      .then(() => this.processPayload(body))
      .catch((err) => console.error('[WhatsApp Webhook] Processing error:', err));
    return reply;
  }

  async waitForIdle(): Promise<void> {
    await this.queue;
  }

  private async processPayload(body: WhatsAppWebhookBody): Promise<void> {
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;

        for (const status of value.statuses ?? []) {
          const wamid = String(status.id ?? '');
          const state = String(status.status ?? '');
          if (!wamid || !state) continue;
          const isNew = await this.database.recordWaStatus(wamid, state);
          if (!isNew) continue;
          await this.database.updateWaMessageStatus(wamid, state);
          if (state === 'failed') {
            await this.database.logEvent(null, null, 'whatsapp.message.failed', {
              wamid,
              errors: status.errors ?? []
            });
          }
        }

        for (const message of value.messages ?? []) {
          await this.processMessage(message, value.contacts?.[0]?.profile?.name);
        }
      }
    }
  }

  private async processMessage(message: Record<string, any>, profileName?: string): Promise<void> {
    const wamid = String(message.id ?? '');
    const from = String(message.from ?? '');
    if (!wamid || !from) return;

    // Webhook retries must be idempotent. DB uniqueness is the source of
    // truth; the in-process set closes the tiny race on a single node.
    if (this.processing.has(wamid)) return;
    if (await this.database.isWaMessageProcessed(wamid)) return;

    const rate = limiters.waInbound.check(from);
    if (!rate.allowed) return;
    this.processing.add(wamid);

    try {
      await this.database.recordWaMessage({
        wamid,
        direction: 'in',
        waId: from,
        type: String(message.type ?? 'unknown'),
        payload: { ...message, profileName },
        status: 'received',
        orderId: null
      });

      const provider = getWhatsAppProvider();
      await provider.markRead(wamid).catch(() => {});

      const textBody: string | undefined = message.text?.body;
      if (textBody) {
        const ownerReply = await shopOwnerAlerts.handleOwnerCommand(from, textBody);
        if (ownerReply) {
          await provider.sendText(from, ownerReply);
          return;
        }
      }

      let interactiveReply: { id: string; title: string } | undefined;
      if (message.type === 'interactive') {
        const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
        if (reply?.id) {
          interactiveReply = { id: String(reply.id), title: String(reply.title ?? '') };
        }
      }
      if (message.type === 'button' && message.button?.payload) {
        interactiveReply = {
          id: String(message.button.payload),
          title: String(message.button.text ?? '')
        };
      }

      if (
        message.type !== 'text' &&
        message.type !== 'document' &&
        message.type !== 'image' &&
        message.type !== 'interactive' &&
        message.type !== 'button'
      ) {
        await provider.sendText(
          from,
          'Sorry, I can only handle text, PDF/image files and the buttons shown above. Send HELP for commands.'
        );
        return;
      }

      await conversationManager.handleInbound({
        from,
        messageId: wamid,
        type: String(message.type ?? 'unknown'),
        text: textBody,
        document: message.document,
        image: message.image,
        interactiveReply
      });
    } finally {
      this.processing.delete(wamid);
    }
  }
}

export const whatsAppWebhookHandler = new WhatsAppWebhookHandler();
