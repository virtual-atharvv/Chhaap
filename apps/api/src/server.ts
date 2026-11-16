import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs/promises';
import { db } from '@chhaap/db';
import {
  calculatePricing,
  DEFAULT_SHOP_CONFIG,
  DEFAULT_STANDARD_INDIAN_RATES
} from '@chhaap/pricing';
import {
  CreateDraftOrderSchema,
  PrintSettingsSchema,
  UpdateOrderItemSettingsSchema,
  AgentPairingRequestSchema
} from '@chhaap/shared';
import { storage } from './storage.js';
import { analyzeDocument } from './document-processor.js';
import { gateway } from './websocket-gateway.js';
import { paymentService } from './payments.js';

const PORT = parseInt(process.env.PORT || '4000', 10);
const HOST = process.env.HOST || '0.0.0.0';

export async function buildServer() {
  const app = Fastify({
    logger: false,
    bodyLimit: 100 * 1024 * 1024 // 100MB upload limit
  });

  await storage.init();

  // Register plugins
  await app.register(cors, { origin: true });
  await app.register(websocket);
  await app.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024 // 100MB
    }
  });

  // Serve preview images statically
  await app.register(fastifyStatic, {
    root: storage.getPreviewsPath(),
    prefix: '/previews/'
  });

  // Base URL tracking for gateway download links
  app.addHook('onRequest', async (req) => {
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host || `localhost:${PORT}`;
    gateway.setBaseUrl(`${proto}://${host}`);
  });

  // ==========================================================================
  // WEBSOCKET AGENT GATEWAY
  // ==========================================================================
  app.get('/v1/agent/connect', { websocket: true }, (socket: any) => {
    gateway.handleAgentConnection(socket);
  });

  // ==========================================================================
  // PUBLIC CUSTOMER API
  // ==========================================================================

  // Shop status & rates
  app.get('/v1/shops/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const shop = db.getShopBySlug(slug);
    if (!shop) {
      return reply.code(404).send({ error: 'Shop not found' });
    }

    const printers = db.getPrintersByShopId(shop.id);
    const hasOnlinePrinter = printers.some((p) => p.status === 'online');
    const isAgentOnline = gateway.isShopAgentOnline(shop.id);
    const rates = db.getRateCardsByShopId(shop.id);

    return {
      shop: {
        id: shop.id,
        slug: shop.slug,
        name: shop.name,
        city: shop.city,
        isOpen: shop.settings.isOpen ?? true,
        printerOnline: hasOnlinePrinter && isAgentOnline,
        minOrderPaise: shop.settings.minOrderPaise ?? 500
      },
      printers: printers.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        status: p.status,
        capabilities: p.capabilities
      })),
      rates: rates.length > 0 ? rates : DEFAULT_STANDARD_INDIAN_RATES
    };
  });

  // Upload file & analyze (extract pages, color detect, generate preview thumbnails)
  app.post('/v1/uploads', async (req, reply) => {
    const data = await req.file();
    if (!data) {
      return reply.code(400).send({ error: 'No file uploaded' });
    }

    const buffer = await data.toBuffer();
    const originalName = data.filename || 'document.pdf';
    const mime = data.mimetype || 'application/pdf';

    // Save to storage
    const { storageKey, sha256, sizeBytes, filePath } = await storage.saveFile(
      buffer,
      originalName,
      mime
    );

    // Create DB file record
    const fileRecord = db.addFile({
      orderId: 'pending',
      storageKey,
      originalName,
      mime,
      sizeBytes,
      sha256,
      scanStatus: 'clean',
      convertedPdfKey: storageKey,
      previewKeys: [],
      deleteAfter: new Date(Date.now() + 86400000).toISOString(),
      deletedAt: null
    });

    // Run PDF analysis pipeline
    const analysis = await analyzeDocument(
      filePath,
      storage.getPreviewsPath(),
      fileRecord.id
    );

    // Update file record with preview keys
    fileRecord.previewKeys = analysis.previewFilenames;

    return {
      fileId: fileRecord.id,
      originalName: fileRecord.originalName,
      sizeBytes: fileRecord.sizeBytes,
      pageCount: analysis.pageCount,
      perPageClassification: analysis.perPageClassification,
      previewUrls: analysis.previewFilenames.map((f) => `/previews/${f}`)
    };
  });

  // Create draft order
  app.post('/v1/orders', async (req, reply) => {
    const body = req.body as Record<string, any>;
    const shop = db.getShopBySlug(body.shopSlug);
    if (!shop) {
      return reply.code(404).send({ error: 'Shop not found' });
    }

    const file = db.getFileById(body.fileId);
    if (!file) {
      return reply.code(404).send({ error: 'File not found' });
    }

    const idempotencyKey = body.idempotencyKey || `idem_${Date.now()}_${Math.random()}`;
    const order = db.createOrder({
      shopId: shop.id,
      customerPhone: body.customerPhone,
      customerEmail: body.customerEmail,
      idempotencyKey
    });

    file.orderId = order.id;

    // Default print settings
    const defaultSettings = PrintSettingsSchema.parse(body.settings || {});

    // Compute pricing
    const perPageClassification = body.perPageClassification || [];
    const pricing = calculatePricing(
      {
        totalPages: body.pageCount || 1,
        perPageClassification,
        settings: defaultSettings
      },
      {
        minOrderPaise: shop.settings.minOrderPaise ?? 500,
        platformConvenienceFeePaise: shop.settings.platformConvenienceFeePaise ?? 100,
        gstRatePercent: shop.settings.gstRatePercent ?? 0,
        rates: db.getRateCardsByShopId(shop.id)
      }
    );

    // Update order totals
    order.subtotalPaise = pricing.subtotalPaise;
    order.feePaise = pricing.feePaise;
    order.gstPaise = pricing.gstPaise;
    order.totalPaise = pricing.totalPaise;

    // Create order item
    const item = db.addOrderItem({
      orderId: order.id,
      fileId: file.id,
      settings: defaultSettings,
      pageCount: body.pageCount || 1,
      colourPages: pricing.colorPagesCount,
      bwPages: pricing.bwPagesCount,
      sheets: pricing.sheets,
      lineTotalPaise: pricing.totalPaise,
      printerId: null
    });

    return {
      order,
      item,
      pricing
    };
  });

  // Update order item settings (live re-pricing on server)
  app.patch('/v1/orders/:orderId/items/:itemId', async (req, reply) => {
    const { orderId, itemId } = req.params as { orderId: string; itemId: string };
    const order = db.getOrderById(orderId);
    if (!order) return reply.code(404).send({ error: 'Order not found' });

    if (order.status !== 'draft' && order.status !== 'awaiting_payment') {
      return reply.code(400).send({ error: 'Cannot modify settings after payment' });
    }

    const item = db.orderItems.get(itemId);
    if (!item || item.orderId !== orderId) {
      return reply.code(404).send({ error: 'Order item not found' });
    }

    const body = req.body as Record<string, any>;
    const validatedSettings = PrintSettingsSchema.parse(body.settings);

    const shop = db.getShopById(order.shopId);
    const pricing = calculatePricing(
      {
        totalPages: item.pageCount,
        perPageClassification: body.perPageClassification,
        settings: validatedSettings
      },
      {
        minOrderPaise: shop?.settings.minOrderPaise ?? 500,
        platformConvenienceFeePaise: shop?.settings.platformConvenienceFeePaise ?? 100,
        gstRatePercent: shop?.settings.gstRatePercent ?? 0,
        rates: shop ? db.getRateCardsByShopId(shop.id) : DEFAULT_STANDARD_INDIAN_RATES
      }
    );

    item.settings = validatedSettings;
    item.colourPages = pricing.colorPagesCount;
    item.bwPages = pricing.bwPagesCount;
    item.sheets = pricing.sheets;
    item.lineTotalPaise = pricing.totalPaise;

    order.subtotalPaise = pricing.subtotalPaise;
    order.feePaise = pricing.feePaise;
    order.gstPaise = pricing.gstPaise;
    order.totalPaise = pricing.totalPaise;

    return {
      order,
      item,
      pricing
    };
  });

  // Get order status
  app.get('/v1/orders/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const order = db.getOrderById(id);
    if (!order) return reply.code(404).send({ error: 'Order not found' });

    const items = db.getOrderItemsByOrderId(order.id);
    const files = items.map((i) => db.getFileById(i.fileId));

    return {
      order,
      items,
      files
    };
  });

  // Server-Sent Events (SSE) status stream
  app.get('/v1/orders/:id/stream', async (req, reply) => {
    const { id } = req.params as { id: string };
    const order = db.getOrderById(id);
    if (!order) return reply.code(404).send({ error: 'Order not found' });

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();

    // Initial event
    reply.raw.write(`data: ${JSON.stringify({ status: order.status, token: order.token })}\n\n`);

    // Subscribe to status transitions
    const unsubscribe = gateway.subscribeOrder(order.id, (status, data) => {
      reply.raw.write(`data: ${JSON.stringify({ status, token: order.token, ...data })}\n\n`);
      if (status === 'completed' || status === 'failed') {
        reply.raw.end();
      }
    });

    req.raw.on('close', () => {
      unsubscribe();
    });
  });

  // Initiate Razorpay checkout
  app.post('/v1/orders/:id/checkout', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const checkout = await paymentService.createCheckout(id);
      return checkout;
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // Simulated instant payment (Walking Skeleton & testing)
  app.post('/v1/orders/:id/fake-pay', async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = await paymentService.simulateSuccessfulPayment(id);
    if (!res.success) {
      return reply.code(400).send({ error: res.error });
    }
    const order = db.getOrderById(id);
    return { success: true, order };
  });

  // Razorpay Webhook endpoint
  app.post('/v1/webhooks/razorpay', async (req, reply) => {
    const signature = req.headers['x-razorpay-signature'] as string;
    const rawBody = JSON.stringify(req.body);

    // Verify signature
    const isValid = paymentService.verifyWebhookSignature(rawBody, signature);
    if (!isValid && process.env.NODE_ENV === 'production') {
      return reply.code(400).send({ error: 'Invalid webhook signature' });
    }

    const payload = req.body as any;
    const eventId = payload.event_id || payload.id || `evt_${Date.now()}`;

    // Deduplicate event
    const isNew = db.recordWebhookEvent('razorpay', eventId, payload);
    if (!isNew) {
      return reply.code(200).send({ status: 'already_processed' });
    }

    if (payload.event === 'payment.captured') {
      const paymentEntity = payload.payload?.payment?.entity;
      if (paymentEntity) {
        await paymentService.handlePaymentCaptured({
          razorpayOrderId: paymentEntity.order_id,
          razorpayPaymentId: paymentEntity.id,
          amountPaise: paymentEntity.amount,
          method: paymentEntity.method,
          rawPayload: payload
        });
      }
    }

    return reply.code(200).send({ status: 'ok' });
  });

  // Agent file download endpoint
  app.get('/v1/files/:fileId/download', async (req, reply) => {
    const { fileId } = req.params as { fileId: string };
    const file = db.getFileById(fileId);
    if (!file || file.deletedAt) {
      return reply.code(404).send({ error: 'File not found or deleted' });
    }

    const filePath = storage.getFilePath(file.storageKey);
    const buffer = await fs.readFile(filePath);

    reply.header('Content-Type', file.mime);
    reply.header('Content-Disposition', `attachment; filename="${file.originalName}"`);
    return reply.send(buffer);
  });

  // ==========================================================================
  // SHOP DASHBOARD API
  // ==========================================================================

  // Live order queue
  app.get('/v1/shop/queue', async (req, reply) => {
    const shopSlug = (req.query as any)?.slug || 'campus-xerox';
    const shop = db.getShopBySlug(shopSlug);
    if (!shop) return reply.code(404).send({ error: 'Shop not found' });

    const orders = db.getOrdersByShopId(shop.id);
    const enrichedOrders = orders.map((o) => {
      const items = db.getOrderItemsByOrderId(o.id);
      const files = items.map((i) => db.getFileById(i.fileId));
      return {
        ...o,
        items,
        files
      };
    });

    return {
      shop,
      orders: enrichedOrders
    };
  });

  // Pair agent
  app.post('/v1/shop/agents/pair', async (req, reply) => {
    const body = req.body as Record<string, any>;
    const code = body.pairingCode;
    const agent = db.getAgentByPairingCode(code);
    if (!agent) {
      return reply.code(400).send({ error: 'Invalid or expired 6-digit pairing code' });
    }

    // Generate permanent token
    const token = `agent_token_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;
    const tokenHash = require('node:crypto').createHash('sha256').update(token).digest('hex');

    db.updateAgent(agent.id, {
      tokenHash,
      pairingCode: null,
      pairingCodeExpiresAt: null
    });

    return {
      agentId: agent.id,
      shopId: agent.shopId,
      token
    };
  });

  // Generate new pairing code
  app.post('/v1/shop/agents/code', async (req, reply) => {
    const shopSlug = (req.body as any)?.slug || 'campus-xerox';
    const shop = db.getShopBySlug(shopSlug);
    if (!shop) return reply.code(404).send({ error: 'Shop not found' });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const agentId = `agent-${Date.now().toString(36)}`;
    const dummyHash = require('node:crypto').createHash('sha256').update(code).digest('hex');

    db.agents.set(agentId, {
      id: agentId,
      shopId: shop.id,
      name: (req.body as any)?.name || 'Shop PC Agent',
      tokenHash: dummyHash,
      pairingCode: code,
      pairingCodeExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      version: '0.1.0',
      lastSeenAt: null,
      os: 'linux',
      status: 'offline',
      createdAt: new Date().toISOString()
    });

    return {
      pairingCode: code,
      expiresInMinutes: 60
    };
  });

  // Shop analytics
  app.get('/v1/shop/analytics', async (req, reply) => {
    const shopSlug = (req.query as any)?.slug || 'campus-xerox';
    const shop = db.getShopBySlug(shopSlug);
    if (!shop) return reply.code(404).send({ error: 'Shop not found' });

    const orders = db.getOrdersByShopId(shop.id);
    const paidOrders = orders.filter((o) => o.status === 'completed' || o.status === 'printing' || o.status === 'queued');

    let totalRevenuePaise = 0;
    let totalBwPages = 0;
    let totalColorPages = 0;
    let totalSheets = 0;

    for (const o of paidOrders) {
      totalRevenuePaise += o.subtotalPaise;
      const items = db.getOrderItemsByOrderId(o.id);
      for (const i of items) {
        totalBwPages += i.bwPages * i.settings.copies;
        totalColorPages += i.colourPages * i.settings.copies;
        totalSheets += i.sheets;
      }
    }

    return {
      todayRevenueRupees: (totalRevenuePaise / 100).toFixed(2),
      totalOrders: paidOrders.length,
      totalBwPages,
      totalColorPages,
      totalSheets
    };
  });

  // ==========================================================================
  // WEB UI ROUTES (Customer PWA, Shop Dashboard, Landing Page)
  // ==========================================================================

  // Customer PWA
  app.get('/s/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const html = getCustomerPWAHtml(slug);
    reply.type('text/html').send(html);
  });

  // Shop Owner Dashboard
  app.get('/shop/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const html = getShopDashboardHtml(slug);
    reply.type('text/html').send(html);
  });

  // Landing Page
  app.get('/', async (_req, reply) => {
    const html = getLandingPageHtml();
    reply.type('text/html').send(html);
  });

  return app;
}

// ============================================================================
// EMBEDDED FRONTEND HTML TEMPLATES
// ============================================================================

function getLandingPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chhaap — QR to Print Automation</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>body { font-family: 'Inter', sans-serif; }</style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex flex-col justify-between">
  <header class="border-b border-slate-800 px-6 py-4 flex justify-between items-center max-w-6xl mx-auto w-full">
    <div class="flex items-center space-x-2">
      <div class="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/30">छ</div>
      <span class="text-xl font-bold tracking-tight text-white">Chhaap</span>
      <span class="text-xs bg-indigo-900/50 text-indigo-300 border border-indigo-700/50 px-2 py-0.5 rounded-full font-mono">v0.1</span>
    </div>
    <div class="flex items-center space-x-4">
      <a href="/shop/campus-xerox" class="text-sm font-medium text-slate-300 hover:text-white transition">Shop Dashboard</a>
      <a href="/s/campus-xerox" class="text-sm bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-4 py-2 rounded-lg transition shadow-md shadow-indigo-600/20">Try Customer PWA</a>
    </div>
  </header>

  <main class="max-w-4xl mx-auto px-6 py-16 text-center my-auto">
    <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-950/60 border border-indigo-800 text-indigo-300 text-xs font-semibold mb-6">
      <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> Walking Skeleton Active & Ready
    </div>
    <h1 class="text-4xl md:text-6xl font-extrabold tracking-tight text-white mb-6 leading-tight">
      Turn any photocopy shop into an <span class="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">automated print kiosk</span>.
    </h1>
    <p class="text-lg md:text-xl text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed">
      Customer scans QR, uploads file, sets options, and pays. The shop's printer prints automatically. Zero WhatsApp forwards. Zero pen-drives. Zero cash friction.
    </p>

    <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
      <a href="/s/campus-xerox" class="w-full sm:w-auto px-8 py-3.5 bg-indigo-600 hover:bg-indigo-500 font-bold rounded-xl text-white shadow-lg shadow-indigo-600/30 transition flex items-center justify-center gap-2">
        <span>Scan & Print as Customer</span>
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
      </a>
      <a href="/shop/campus-xerox" class="w-full sm:w-auto px-8 py-3.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 font-semibold rounded-xl text-slate-200 transition">
        Open Shop Owner Console
      </a>
    </div>

    <!-- Moat features cards -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16 text-left">
      <div class="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
        <div class="text-2xl mb-2">⚡</div>
        <h3 class="font-bold text-white text-base mb-1">Outbound-Only WebSocket</h3>
        <p class="text-xs text-slate-400">Agent connects from shop PC out to the cloud. Zero port forwarding, no static IP required.</p>
      </div>
      <div class="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
        <div class="text-2xl mb-2">🎯</div>
        <h3 class="font-bold text-white text-base mb-1">Smart Per-Page Billing</h3>
        <p class="text-xs text-slate-400">Ghostscript inkcov classifies each page. 47 B&W + 3 Colour billed with zero revenue leakage.</p>
      </div>
      <div class="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
        <div class="text-2xl mb-2">🛡️</div>
        <h3 class="font-bold text-white text-base mb-1">Provable Privacy</h3>
        <p class="text-xs text-slate-400">Documents auto-deleted 15 minutes after print. Customer Aadhaar and marksheets stay safe.</p>
      </div>
    </div>
  </main>

  <footer class="border-t border-slate-800/80 px-6 py-6 text-center text-xs text-slate-500">
    Chhaap Platform Prototype · Built for Lucknow Stationery & Photocopy Shops
  </footer>
</body>
</html>`;
}

function getCustomerPWAHtml(shopSlug: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Chhaap — Quick Print</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; -webkit-tap-highlight-color: transparent; }
    .step-active { display: block; }
    .step-hidden { display: none; }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex flex-col justify-between">
  <!-- Mobile Header -->
  <header class="bg-slate-900/90 backdrop-blur border-b border-slate-800 px-4 py-3 sticky top-0 z-20 flex justify-between items-center">
    <div class="flex items-center space-x-2">
      <div class="w-7 h-7 rounded-md bg-indigo-600 flex items-center justify-center font-bold text-white text-sm">छ</div>
      <div>
        <h1 id="shopNameDisplay" class="text-sm font-bold tracking-tight text-white leading-tight">Campus Xerox</h1>
        <p class="text-[10px] text-emerald-400 flex items-center gap-1">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> Printer Ready
        </p>
      </div>
    </div>
    <div class="text-right">
      <span class="text-xs font-mono bg-slate-800 border border-slate-700 px-2 py-0.5 rounded text-slate-300">Lucknow</span>
    </div>
  </header>

  <main class="max-w-md mx-auto w-full p-4 flex-1">
    <!-- STEP 1: UPLOAD -->
    <div id="stepUpload" class="step-active">
      <div class="text-center py-6">
        <h2 class="text-xl font-extrabold text-white mb-1">Print your document</h2>
        <p class="text-xs text-slate-400">PDF, Docs, or Images · Files deleted after print</p>
      </div>

      <div id="dropzone" class="border-2 border-dashed border-indigo-500/50 hover:border-indigo-400 bg-slate-900/40 rounded-2xl p-8 text-center cursor-pointer transition flex flex-col items-center justify-center">
        <input type="file" id="fileInput" accept=".pdf,image/*" class="hidden">
        <div class="w-14 h-14 rounded-full bg-indigo-900/40 border border-indigo-700/60 flex items-center justify-center text-indigo-300 mb-3 text-2xl">
          📄
        </div>
        <p class="text-sm font-semibold text-white mb-1">Tap to upload file</p>
        <p class="text-[11px] text-slate-400">PDF up to 50MB</p>
      </div>

      <div id="uploadProgress" class="hidden mt-4 text-center">
        <div class="w-full bg-slate-800 h-2 rounded-full overflow-hidden mb-2">
          <div class="bg-indigo-500 h-full w-2/3 animate-pulse"></div>
        </div>
        <p class="text-xs text-indigo-300 font-medium">Analyzing pages & colour coverage...</p>
      </div>

      <div class="mt-8 bg-slate-900/60 border border-slate-800/80 rounded-xl p-3.5 flex items-center gap-3">
        <span class="text-lg">🔒</span>
        <p class="text-[11px] text-slate-400 leading-snug">
          <strong class="text-slate-300">Privacy Guarantee:</strong> Files are processed in memory and permanently deleted 15 minutes after printing.
        </p>
      </div>
    </div>

    <!-- STEP 2: CONFIGURE & PREVIEW -->
    <div id="stepConfig" class="step-hidden">
      <div class="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
        <div class="truncate mr-2">
          <p id="docName" class="text-xs font-semibold text-white truncate">document.pdf</p>
          <p id="docInfo" class="text-[10px] text-slate-400">10 pages detected</p>
        </div>
        <button id="btnChangeFile" class="text-xs text-indigo-400 hover:text-indigo-300 font-medium">Change</button>
      </div>

      <!-- Preview Thumbnail Carousel -->
      <div class="mb-5">
        <label class="text-[11px] font-semibold text-slate-300 mb-1.5 block flex items-center justify-between">
          <span>WYSIWYP Preview (First pages)</span>
          <span class="text-[10px] text-slate-500">Live render</span>
        </label>
        <div id="previewContainer" class="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
          <!-- Populated dynamically with preview images -->
        </div>
      </div>

      <!-- Settings Controls -->
      <div class="space-y-4 bg-slate-900/60 p-4 rounded-2xl border border-slate-800">
        <!-- Color Mode -->
        <div>
          <label class="text-[11px] font-semibold text-slate-300 mb-1 block">Print Mode</label>
          <div class="grid grid-cols-3 gap-2">
            <button type="button" data-mode="bw" class="color-btn active py-2 px-2 text-xs font-semibold rounded-lg border bg-indigo-600 border-indigo-500 text-white transition text-center">
              All B&W
            </button>
            <button type="button" data-mode="smart" class="color-btn py-2 px-2 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 transition text-center">
              Smart ✨
            </button>
            <button type="button" data-mode="color" class="color-btn py-2 px-2 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 transition text-center">
              Colour
            </button>
          </div>
          <p id="colorExplanation" class="text-[10px] text-slate-400 mt-1">₹2 / page · Standard black & white</p>
        </div>

        <!-- Sides (Single vs Duplex) -->
        <div>
          <label class="text-[11px] font-semibold text-slate-300 mb-1 block">Sides</label>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" data-sides="single" class="sides-btn active py-2 text-xs font-semibold rounded-lg border bg-indigo-600 border-indigo-500 text-white transition">
              Single-sided
            </button>
            <button type="button" data-sides="duplex" class="sides-btn py-2 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 transition">
              Back-to-Back (Duplex)
            </button>
          </div>
        </div>

        <!-- Copies & Paper Size -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-[11px] font-semibold text-slate-300 mb-1 block">Copies</label>
            <div class="flex items-center border border-slate-700 rounded-lg bg-slate-800 overflow-hidden">
              <button id="btnMinusCopy" class="px-3 py-1.5 text-slate-300 hover:bg-slate-700 font-bold">-</button>
              <input type="number" id="inputCopies" value="1" min="1" max="100" class="w-full text-center bg-transparent text-xs font-bold text-white focus:outline-none">
              <button id="btnPlusCopy" class="px-3 py-1.5 text-slate-300 hover:bg-slate-700 font-bold">+</button>
            </div>
          </div>
          <div>
            <label class="text-[11px] font-semibold text-slate-300 mb-1 block">Paper Size</label>
            <select id="selectPaper" class="w-full py-2 px-2.5 bg-slate-800 border border-slate-700 rounded-lg text-xs font-semibold text-white focus:outline-none">
              <option value="A4">A4 (Standard)</option>
              <option value="A3">A3 (Large)</option>
              <option value="Legal">Legal</option>
            </select>
          </div>
        </div>

        <!-- Page Range -->
        <div>
          <label class="text-[11px] font-semibold text-slate-300 mb-1 block">Page Range (optional)</label>
          <input type="text" id="inputPageRange" placeholder="e.g. 1-5, 8, 11-13 (leave blank for all)" class="w-full py-2 px-3 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500">
        </div>
      </div>

      <!-- Price Breakdown Card -->
      <div class="mt-4 bg-indigo-950/40 border border-indigo-800/60 rounded-xl p-3.5 space-y-1.5">
        <div class="flex justify-between text-xs text-slate-300">
          <span id="breakdownText">10 B&W pages × ₹2</span>
          <span id="breakdownSubtotal">₹20.00</span>
        </div>
        <div class="flex justify-between text-xs text-slate-400">
          <span>Sheets required</span>
          <span id="sheetsCount" class="font-medium text-slate-300">10 sheets</span>
        </div>
        <div class="flex justify-between text-xs text-slate-400">
          <span>Platform convenience fee</span>
          <span>₹1.00</span>
        </div>
        <div class="border-t border-indigo-800/50 pt-2 flex justify-between items-center text-sm font-bold text-white">
          <span>Total Amount</span>
          <span id="totalAmountText" class="text-emerald-400 text-lg">₹21.00</span>
        </div>
      </div>

      <!-- Pay Action Buttons -->
      <div class="mt-5 space-y-2">
        <button id="btnPay" class="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2">
          <span>Pay & Print Instantly</span>
          <span id="btnPayAmount" class="bg-emerald-700/60 px-2 py-0.5 rounded text-xs">₹21.00</span>
        </button>
      </div>
    </div>

    <!-- STEP 3: LIVE STATUS & TOKEN -->
    <div id="stepStatus" class="step-hidden text-center py-6">
      <div class="w-16 h-16 rounded-full bg-emerald-950 border-2 border-emerald-500 text-emerald-400 flex items-center justify-center mx-auto mb-4 text-3xl animate-bounce">
        ✓
      </div>
      <h2 class="text-xl font-extrabold text-white mb-1">Payment Verified</h2>
      <p id="liveStatusText" class="text-xs text-slate-400 mb-6">Dispatching to shop printer...</p>

      <!-- Pickup Token Card -->
      <div class="bg-slate-900 border-2 border-indigo-500/60 rounded-2xl p-6 shadow-xl mb-6">
        <p class="text-xs font-semibold uppercase tracking-wider text-indigo-400 mb-1">Pickup Token</p>
        <p id="pickupToken" class="text-5xl font-black tracking-tight text-white font-mono">B-047</p>
        <p class="text-[11px] text-slate-400 mt-2">Show this token at the counter to collect your print</p>
      </div>

      <!-- Realtime Progress Timeline -->
      <div class="bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-left space-y-3">
        <div id="tlPaid" class="flex items-center gap-3 text-xs text-emerald-400 font-semibold">
          <span class="w-3 h-3 rounded-full bg-emerald-400"></span> 1. Payment Verified
        </div>
        <div id="tlQueued" class="flex items-center gap-3 text-xs text-slate-400">
          <span class="w-3 h-3 rounded-full bg-slate-700"></span> 2. Queued on Shop PC
        </div>
        <div id="tlPrinting" class="flex items-center gap-3 text-xs text-slate-400">
          <span class="w-3 h-3 rounded-full bg-slate-700"></span> 3. Printing
        </div>
        <div id="tlDone" class="flex items-center gap-3 text-xs text-slate-400">
          <span class="w-3 h-3 rounded-full bg-slate-700"></span> 4. Ready for Pickup
        </div>
      </div>
    </div>
  </main>

  <footer class="border-t border-slate-900 p-3 text-center text-[10px] text-slate-600">
    Chhaap Automated Print Kiosk · Clean, Cashless, Queue-free
  </footer>

  <script>
    const shopSlug = "${shopSlug}";
    let currentUploaded = null;
    let currentOrder = null;
    let currentPricing = null;
    let sseSource = null;

    // State settings
    const settings = {
      copies: 1,
      paperSize: 'A4',
      colorMode: 'bw',
      sides: 'single',
      pagesPerSheet: 1,
      pageRange: ''
    };

    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const uploadProgress = document.getElementById('uploadProgress');

    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        uploadFile(e.target.files[0]);
      }
    });

    async function uploadFile(file) {
      dropzone.classList.add('hidden');
      uploadProgress.classList.remove('hidden');

      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await fetch('/v1/uploads', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');

        currentUploaded = data;
        createInitialOrder();
      } catch (err) {
        alert(err.message);
        dropzone.classList.remove('hidden');
        uploadProgress.classList.add('hidden');
      }
    }

    async function createInitialOrder() {
      try {
        const res = await fetch('/v1/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shopSlug,
            fileId: currentUploaded.fileId,
            pageCount: currentUploaded.pageCount,
            perPageClassification: currentUploaded.perPageClassification,
            settings
          })
        });

        const data = await res.json();
        currentOrder = data.order;
        currentPricing = data.pricing;

        showStepConfig();
      } catch (err) {
        alert('Failed to initialize order: ' + err.message);
      }
    }

    function showStepConfig() {
      document.getElementById('stepUpload').classList.replace('step-active', 'step-hidden');
      document.getElementById('stepConfig').classList.replace('step-hidden', 'step-active');

      document.getElementById('docName').innerText = currentUploaded.originalName;
      document.getElementById('docInfo').innerText = currentUploaded.pageCount + ' pages detected';

      // Previews
      const container = document.getElementById('previewContainer');
      container.innerHTML = '';
      if (currentUploaded.previewUrls && currentUploaded.previewUrls.length > 0) {
        currentUploaded.previewUrls.forEach((url, idx) => {
          const img = document.createElement('img');
          img.src = url;
          img.className = 'w-24 h-32 object-cover rounded-lg border border-slate-700 shadow-md flex-shrink-0';
          container.appendChild(img);
        });
      } else {
        container.innerHTML = '<div class="w-full text-center text-xs text-slate-500 py-4 bg-slate-900 rounded-lg">Preview generated upon print dispatch</div>';
      }

      updatePricingUI();
    }

    async function repriceOrder() {
      if (!currentOrder) return;
      try {
        const itemId = currentOrder.items ? currentOrder.items[0].id : (await fetch('/v1/orders/' + currentOrder.id).then(r=>r.json())).items[0].id;
        const res = await fetch('/v1/orders/' + currentOrder.id + '/items/' + itemId, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            settings,
            perPageClassification: currentUploaded.perPageClassification
          })
        });
        const data = await res.json();
        currentOrder = data.order;
        currentPricing = data.pricing;
        updatePricingUI();
      } catch (err) {
        console.error('Reprice error:', err);
      }
    }

    function updatePricingUI() {
      if (!currentPricing) return;
      const totalRupees = (currentPricing.totalPaise / 100).toFixed(2);
      document.getElementById('totalAmountText').innerText = '₹' + totalRupees;
      document.getElementById('btnPayAmount').innerText = '₹' + totalRupees;
      document.getElementById('sheetsCount').innerText = currentPricing.sheets + ' sheets';

      if (settings.colorMode === 'smart') {
        document.getElementById('breakdownText').innerText = currentPricing.bwPagesCount + ' B&W (₹2) + ' + currentPricing.colorPagesCount + ' Colour (₹10)';
      } else if (settings.colorMode === 'color') {
        document.getElementById('breakdownText').innerText = currentPricing.selectedCount + ' Colour pages (₹10)';
      } else {
        document.getElementById('breakdownText').innerText = currentPricing.selectedCount + ' B&W pages (₹2)';
      }
      document.getElementById('breakdownSubtotal').innerText = '₹' + (currentPricing.subtotalPaise / 100).toFixed(2);
    }

    // Color buttons
    document.querySelectorAll('.color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.color-btn').forEach(b => {
          b.className = 'color-btn py-2 px-2 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 transition text-center';
        });
        btn.className = 'color-btn active py-2 px-2 text-xs font-semibold rounded-lg border bg-indigo-600 border-indigo-500 text-white transition text-center';
        settings.colorMode = btn.dataset.mode;
        repriceOrder();
      });
    });

    // Sides buttons
    document.querySelectorAll('.sides-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sides-btn').forEach(b => {
          b.className = 'sides-btn py-2 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 transition';
        });
        btn.className = 'sides-btn active py-2 text-xs font-semibold rounded-lg border bg-indigo-600 border-indigo-500 text-white transition';
        settings.sides = btn.dataset.sides;
        repriceOrder();
      });
    });

    // Copies
    document.getElementById('btnMinusCopy').addEventListener('click', () => {
      if (settings.copies > 1) {
        settings.copies--;
        document.getElementById('inputCopies').value = settings.copies;
        repriceOrder();
      }
    });
    document.getElementById('btnPlusCopy').addEventListener('click', () => {
      settings.copies++;
      document.getElementById('inputCopies').value = settings.copies;
      repriceOrder();
    });

    // Paper size
    document.getElementById('selectPaper').addEventListener('change', (e) => {
      settings.paperSize = e.target.value;
      repriceOrder();
    });

    // Page range
    document.getElementById('inputPageRange').addEventListener('change', (e) => {
      settings.pageRange = e.target.value;
      repriceOrder();
    });

    // Pay action
    document.getElementById('btnPay').addEventListener('click', async () => {
      const btn = document.getElementById('btnPay');
      btn.disabled = true;
      btn.innerText = 'Processing Payment...';

      try {
        const res = await fetch('/v1/orders/' + currentOrder.id + '/fake-pay', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Payment failed');

        showStepStatus(data.order);
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
        btn.innerText = 'Pay & Print Instantly';
      }
    });

    function showStepStatus(order) {
      document.getElementById('stepConfig').classList.replace('step-active', 'step-hidden');
      document.getElementById('stepStatus').classList.replace('step-hidden', 'step-active');
      document.getElementById('pickupToken').innerText = order.token;

      // Connect to SSE stream
      sseSource = new EventSource('/v1/orders/' + order.id + '/stream');
      sseSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleLiveStatusUpdate(data.status);
      };
    }

    function handleLiveStatusUpdate(status) {
      const tlQueued = document.getElementById('tlQueued');
      const tlPrinting = document.getElementById('tlPrinting');
      const tlDone = document.getElementById('tlDone');
      const statusText = document.getElementById('liveStatusText');

      if (status === 'queued') {
        tlQueued.className = 'flex items-center gap-3 text-xs text-indigo-400 font-semibold';
        tlQueued.children[0].className = 'w-3 h-3 rounded-full bg-indigo-400 animate-pulse';
        statusText.innerText = 'Received by shop PC · Queued in spooler';
      } else if (status === 'printing') {
        tlQueued.className = 'flex items-center gap-3 text-xs text-emerald-400 font-semibold';
        tlQueued.children[0].className = 'w-3 h-3 rounded-full bg-emerald-400';
        tlPrinting.className = 'flex items-center gap-3 text-xs text-indigo-400 font-semibold';
        tlPrinting.children[0].className = 'w-3 h-3 rounded-full bg-indigo-400 animate-pulse';
        statusText.innerText = 'Printing on printer right now...';
      } else if (status === 'completed') {
        tlPrinting.className = 'flex items-center gap-3 text-xs text-emerald-400 font-semibold';
        tlPrinting.children[0].className = 'w-3 h-3 rounded-full bg-emerald-400';
        tlDone.className = 'flex items-center gap-3 text-xs text-emerald-400 font-bold';
        tlDone.children[0].className = 'w-3 h-3 rounded-full bg-emerald-400';
        statusText.innerText = '🎉 Print Finished! Ready for pickup at counter';
        if (sseSource) sseSource.close();
      }
    }
  </script>
</body>
</html>`;
}

function getShopDashboardHtml(shopSlug: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chhaap — Shop Owner Console</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>body { font-family: 'Inter', sans-serif; }</style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen">
  <!-- Top Navigation -->
  <header class="bg-slate-900 border-b border-slate-800 px-6 py-4 flex justify-between items-center sticky top-0 z-30">
    <div class="flex items-center space-x-3">
      <div class="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-600/30">छ</div>
      <div>
        <h1 class="text-base font-bold text-white flex items-center gap-2">
          Campus Xerox & Stationary
          <span class="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded-full font-medium">Starter Plan (Active)</span>
        </h1>
        <p class="text-xs text-slate-400">Lucknow · Counter Console</p>
      </div>
    </div>
    <div class="flex items-center space-x-3">
      <button id="btnPairAgent" class="text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-lg font-medium transition">
        Pair Agent PC
      </button>
      <a href="/s/${shopSlug}" target="_blank" class="text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-3 py-1.5 rounded-lg transition shadow-md shadow-indigo-600/20">
        Open Customer QR Link ↗
      </a>
    </div>
  </header>

  <main class="max-w-7xl mx-auto p-6 space-y-6">
    <!-- Stat Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
        <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Today's Revenue</p>
        <p id="statRevenue" class="text-2xl font-black text-white">₹0.00</p>
        <p class="text-[11px] text-emerald-400 mt-1">Cashless & verified via Razorpay</p>
      </div>
      <div class="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
        <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Paid Orders</p>
        <p id="statOrders" class="text-2xl font-black text-indigo-400">0</p>
        <p class="text-[11px] text-slate-500 mt-1">Zero cash counting errors</p>
      </div>
      <div class="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
        <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Pages Printed</p>
        <p id="statPages" class="text-2xl font-black text-cyan-400">0</p>
        <p id="statPagesSplit" class="text-[11px] text-slate-400 mt-1">0 B&W · 0 Colour</p>
      </div>
      <div class="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
        <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Printer Agent Health</p>
        <div class="flex items-center gap-2 mt-1">
          <span id="agentIndicator" class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
          <span id="agentStatusText" class="text-base font-bold text-white">Online</span>
        </div>
        <p class="text-[11px] text-slate-400 mt-1">Virtual CUPS-PDF (PDF)</p>
      </div>
    </div>

    <!-- Live Order Queue -->
    <div class="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
      <div class="p-4 border-b border-slate-800 flex justify-between items-center">
        <div>
          <h2 class="text-base font-bold text-white">Live Print Queue</h2>
          <p class="text-xs text-slate-400">Automatically dispatches jobs over outbound WebSocket</p>
        </div>
        <button id="btnRefresh" class="text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 rounded-lg text-slate-300 font-medium transition">
          Refresh Queue
        </button>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-900 text-slate-400 uppercase font-semibold border-b border-slate-800">
            <tr>
              <th class="p-3.5">Pickup Token</th>
              <th class="p-3.5">Document</th>
              <th class="p-3.5">Options</th>
              <th class="p-3.5">Amount</th>
              <th class="p-3.5">Status</th>
              <th class="p-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody id="queueBody" class="divide-y divide-slate-800/60">
            <tr>
              <td colspan="6" class="p-6 text-center text-slate-500">No print jobs in queue yet. Scan the QR code to create the first test order!</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </main>

  <script>
    const shopSlug = "${shopSlug}";

    async function fetchQueue() {
      try {
        const res = await fetch('/v1/shop/queue?slug=' + shopSlug);
        const data = await res.json();
        renderQueue(data.orders || []);

        const analyticsRes = await fetch('/v1/shop/analytics?slug=' + shopSlug);
        const analytics = await analyticsRes.json();
        document.getElementById('statRevenue').innerText = '₹' + analytics.todayRevenueRupees;
        document.getElementById('statOrders').innerText = analytics.totalOrders;
        document.getElementById('statPages').innerText = (analytics.totalBwPages + analytics.totalColorPages);
        document.getElementById('statPagesSplit').innerText = analytics.totalBwPages + ' B&W · ' + analytics.totalColorPages + ' Colour';
      } catch (err) {
        console.error('Queue fetch failed:', err);
      }
    }

    function renderQueue(orders) {
      const tbody = document.getElementById('queueBody');
      if (orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-500">No orders yet.</td></tr>';
        return;
      }

      tbody.innerHTML = orders.map(o => {
        const item = o.items && o.items[0];
        const file = o.files && o.files[0];
        const docName = file ? file.originalName : 'document.pdf';
        const copies = item ? item.settings.copies : 1;
        const color = item ? item.settings.colorMode : 'bw';
        const sides = item ? item.settings.sides : 'single';

        let badge = '<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-400">' + o.status + '</span>';
        if (o.status === 'completed') badge = '<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800">Done</span>';
        if (o.status === 'printing') badge = '<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-950 text-indigo-400 border border-indigo-800 animate-pulse">Printing</span>';
        if (o.status === 'queued') badge = '<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-950 text-amber-400 border border-amber-800">Queued</span>';

        return '<tr class="hover:bg-slate-900/40 transition">' +
          '<td class="p-3.5 font-mono font-bold text-sm text-indigo-400">' + o.token + '</td>' +
          '<td class="p-3.5 font-medium text-white truncate max-w-xs">' + docName + '</td>' +
          '<td class="p-3.5 text-slate-400">' + copies + ' copy · ' + color.toUpperCase() + ' · ' + sides + '</td>' +
          '<td class="p-3.5 font-bold text-white">₹' + (o.totalPaise / 100).toFixed(2) + '</td>' +
          '<td class="p-3.5">' + badge + '</td>' +
          '<td class="p-3.5 text-right space-x-2">' +
            (o.status === 'completed' ? '<span class="text-emerald-400 font-semibold text-[11px]">Ready for Pickup</span>' : '') +
          '</td>' +
        '</tr>';
      }).join('');
    }

    document.getElementById('btnRefresh').addEventListener('click', fetchQueue);
    document.getElementById('btnPairAgent').addEventListener('click', async () => {
      const res = await fetch('/v1/shop/agents/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: shopSlug })
      });
      const data = await res.json();
      alert('6-Digit Agent Pairing Code: ' + data.pairingCode + '\\n\\nEnter this on the shop PC to link the agent!');
    });

    fetchQueue();
    setInterval(fetchQueue, 3000);
  </script>
</body>
</html>`;
}
