import type { FastifyPluginAsync } from 'fastify';
import { whatsAppWebhookHandler } from '../whatsapp/webhook.js';

export const whatsAppRoutes: FastifyPluginAsync = async (app) => {
  // GET /v1/webhooks/whatsapp (Verification handshake)
  app.get('/v1/webhooks/whatsapp', async (req, reply) => {
    return whatsAppWebhookHandler.handleVerification(req, reply);
  });

  // POST /v1/webhooks/whatsapp (Inbound messages & status updates)
  app.post('/v1/webhooks/whatsapp', async (req, reply) => {
    return whatsAppWebhookHandler.handleInbound(req, reply);
  });
};
