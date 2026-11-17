import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { loadConfig } from './config.js';
import { storage } from './storage.js';
import { gateway } from './websocket-gateway.js';
import { reconciliationCron } from './reconciliation.js';
import { authRoutes } from './routes/auth.js';
import { shopRoutes } from './routes/shop.js';
import { publicRoutes } from './routes/public.js';
import { webhookRoutes } from './routes/webhooks.js';
import { whatsAppRoutes } from './routes/whatsapp.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '../../web/public');

export async function buildServer(): Promise<FastifyInstance> {
  const config = loadConfig();

  const app = Fastify({
    logger:
      config.nodeEnv === 'test'
        ? false
        : {
            level: config.logLevel,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers["x-hub-signature-256"]',
                '*.phone',
                '*.customerPhone',
                '*.customerWaId',
                '*.waId',
                '*.whatsappNumber',
                '*.originalName',
                '*.accessToken',
                '*.razorpayPaymentId'
              ],
              censor: '[REDACTED]'
            }
          },
    bodyLimit: 1024 * 1024,
    genReqId: () => crypto.randomUUID()
  });

  // Keep exact raw bytes for HMAC verification. Fastify's default JSON parser
  // re-serialises, which would break Razorpay/Meta signatures.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      (req as any).rawBody = body;
      try {
        done(null, JSON.parse((body as Buffer).toString('utf-8')));
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  await storage.init();
  storage.startSweeper();
  gateway.start();
  reconciliationCron.start();

  await app.register(cors, {
    origin: config.nodeEnv === 'production' ? config.publicBaseUrl : true,
    credentials: true
  });
  await app.register(websocket);
  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadBytes,
      files: 1,
      fields: 10
    }
  });

  // Private preview thumbnails (unguessable UUID-based filenames).
  await app.register(fastifyStatic, {
    root: storage.getPreviewsPath(),
    prefix: '/previews/',
    decorateReply: false,
    cacheControl: false
  });

  // Customer PWA, shop dashboard and simulated-pay page. Single-port serving
  // keeps the pilot simple; the files live in apps/web/public.
  await app.register(fastifyStatic, {
    root: webRoot,
    prefix: '/',
    index: false,
    decorateReply: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    }
  });

  app.addHook('onRequest', async (req) => {
    const proto = (req.headers['x-forwarded-proto'] as string) || 'http';
    const host = req.headers.host || `localhost:${config.port}`;
    gateway.setBaseUrl(`${proto}://${host}`);
  });

  app.get('/v1/agent/connect', { websocket: true }, (socket: any) => {
    gateway.handleAgentConnection(socket);
  });

  await app.register(authRoutes);
  await app.register(shopRoutes);
  await app.register(publicRoutes);
  await app.register(webhookRoutes);
  await app.register(whatsAppRoutes);

  const page = (file: string) => async (_req: unknown, reply: any) => {
    reply.header('Cache-Control', 'no-cache');
    return reply.sendFile(file);
  };
  app.get('/', page('index.html'));
  app.get('/s/:slug', page('customer.html'));
  app.get('/o/:orderId', page('order.html'));
  app.get('/shop/:slug', page('shop.html'));
  app.get('/pay/:linkId', page('pay.html'));

  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) {
      req.log.error({ err, reqId: req.id }, 'Unhandled request error');
    }
    if (reply.sent) return;
    reply.code(status).send({
      error: status >= 500 && config.nodeEnv === 'production' ? 'Internal server error' : err.message,
      requestId: req.id
    });
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/v1/')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.code(404).type('text/plain').send('Not found');
  });

  app.addHook('onClose', async () => {
    storage.stopSweeper();
    reconciliationCron.stop();
    gateway.stop();
  });

  return app;
}
