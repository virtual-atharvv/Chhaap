#!/usr/bin/env node
/**
 * Offline WhatsApp demo: replays a complete fake conversation through the real
 * API, mock Meta provider, mock payment link and a virtual print agent. No
 * network access beyond 127.0.0.1 and no Meta/Razorpay credentials required.
 *
 * Run from the repo root: pnpm demo:whatsapp
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const dataDir = path.join(os.tmpdir(), `chhaap-wa-demo-${crypto.randomUUID()}`);
const waId = '919876543210';
const appSecret = 'demo_wa_app_secret';
const operatorToken = 'test_agent_secret_token_123';

process.env.NODE_ENV = 'test';
process.env.DB_MODE = 'memory';
process.env.PAYMENTS_MODE = 'simulated';
process.env.WHATSAPP_MODE = 'mock';
process.env.JWT_SECRET = 'demo_jwt_secret_at_least_32_characters_long';
process.env.WHATSAPP_APP_SECRET = appSecret;
process.env.WHATSAPP_VERIFY_TOKEN = 'demo_verify_token';
process.env.CHHAAP_DATA_DIR = dataDir;
process.env.LOG_LEVEL = 'silent';

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** Builds a tiny one-page PDF at runtime; no Ghostscript needed. */
function samplePdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    '<< /Length 44 >>\nstream\nBT /F1 24 Tf 72 720 Td (Chhaap demo) Tj ET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index++) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

class DemoAgent {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.dispatches = [];
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('agent connect timeout')), 5000);
      this.ws.on('open', () => {
        this.ws.send(
          JSON.stringify({
            type: 'hello',
            agentId: 'agent-campus-1',
            token: operatorToken,
            version: '0.2.0',
            os: 'linux-demo',
            printers: [
              {
                systemName: 'PDF',
                displayName: 'Virtual PDF printer',
                color: true,
                duplex: true,
                papers: ['A4', 'A3', 'Legal']
              }
            ]
          })
        );
      });
      this.ws.on('message', (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.type === 'ack') {
          clearTimeout(timer);
          resolve();
        }
        if (message.type === 'job.dispatch') {
          this.dispatches.push(message);
          this.ws.send(JSON.stringify({ type: 'job.accepted', jobId: message.jobId }));
          this.ws.send(
            JSON.stringify({
              type: 'job.progress',
              jobId: message.jobId,
              state: 'printing',
              pagesPrinted: message.pageCount
            })
          );
          setTimeout(() => {
            this.ws.send(
              JSON.stringify({
                type: 'job.result',
                jobId: message.jobId,
                ok: true,
                pagesPrinted: message.pageCount * (message.settings.copies || 1)
              })
            );
          }, 250);
        }
      });
      this.ws.on('error', reject);
    });
  }

  close() {
    this.ws?.close();
  }
}

let sequence = 0;
function inbound(message) {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'demo-waba',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '919876543210', phone_number_id: 'demo-phone' },
              contacts: [{ profile: { name: 'Demo Customer' }, wa_id: waId }],
              messages: [
                {
                  from: waId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  id: `wamid.demo.${Date.now()}.${++sequence}`,
                  ...message
                }
              ]
            }
          }
        ]
      }
    ]
  });
}

function signature(raw) {
  return 'sha256=' + crypto.createHmac('sha256', appSecret).update(raw).digest('hex');
}

async function main() {
  await fs.mkdir(dataDir, { recursive: true });
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  process.env.PORT = String(port);
  process.env.PUBLIC_BASE_URL = baseUrl;

  const { buildServer } = await import('../dist/server.js');
  const { mockWhatsAppProvider } = await import('../dist/whatsapp/mock-provider.js');
  const { whatsAppWebhookHandler } = await import('../dist/whatsapp/webhook.js');

  const app = await buildServer();
  await app.listen({ port, host: '127.0.0.1' });

  const agent = new DemoAgent(`ws://127.0.0.1:${port}/v1/agent/connect`);
  await agent.connect();

  // The agent handshake is asynchronous; wait until the cloud considers the
  // printer online or the bot will (correctly) refuse the order.
  const onlineDeadline = Date.now() + 5000;
  while (Date.now() < onlineDeadline) {
    const response = await fetch(`${baseUrl}/v1/shops/campus-xerox`);
    const data = await response.json();
    if (data.shop?.printerOnline) break;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }

  const outboundStart = mockWhatsAppProvider.outbound.length;

  async function post(message) {
    const raw = inbound(message);
    const response = await fetch(`${baseUrl}/v1/webhooks/whatsapp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature(raw)
      },
      body: raw
    });
    if (!response.ok) throw new Error(`webhook returned ${response.status}`);
    await whatsAppWebhookHandler.waitForIdle();
  }

  async function waitFor(matcher, label, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const messages = mockWhatsAppProvider.outbound.slice(outboundStart);
      if (matcher(messages)) return messages;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    const seen = mockWhatsAppProvider.outbound
      .slice(outboundStart)
      .map((m) => `${m.type}: ${m.body ?? m.templateName ?? ''}`)
      .join('\n  ');
    throw new Error(`Timed out waiting for ${label}. Outbound so far:\n  ${seen || '(none)'}`);
  }

  const pdf = samplePdf();
  mockWhatsAppProvider.registerMockMedia('demo-media-1', pdf, 'application/pdf', 'assignment.pdf');

  await post({ type: 'text', text: { body: 'PRINT campus-xerox' } });
  await waitFor(
    (messages) => messages.some((m) => m.buttons?.some((b) => b.id === 'lang_en')),
    'language menu'
  );

  await post({
    type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id: 'lang_en', title: 'English' } }
  });
  await waitFor((messages) => messages.some((m) => /send the PDF or image/i.test(m.body ?? '')), 'file prompt');

  await post({
    type: 'document',
    document: {
      id: 'demo-media-1',
      mime_type: 'application/pdf',
      filename: 'assignment.pdf',
      sha256: 'demo'
    }
  });
  await waitFor((messages) => messages.some((m) => /select colour mode/i.test(m.body ?? '')), 'colour menu');

  await post({
    type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id: 'color_bw', title: 'All B&W' } }
  });
  await waitFor((messages) => messages.some((m) => /select sides/i.test(m.body ?? '')), 'sides menu');

  await post({
    type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id: 'sides_duplex', title: 'Back-to-Back' } }
  });
  await waitFor((messages) => messages.some((m) => /select number of copies/i.test(m.body ?? '')), 'copies menu');

  await post({
    type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id: 'copies_2', title: '2 Copies' } }
  });
  await waitFor((messages) => messages.some((m) => /Order Summary/i.test(m.body ?? '')), 'review');

  await post({
    type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id: 'pay_now', title: 'Pay now' } }
  });
  const withLink = await waitFor(
    (messages) => messages.some((m) => /\/pay\/plink_sim_/.test(m.body ?? '')),
    'payment link'
  );
  const linkBody = withLink.find((m) => /\/pay\/plink_sim_/.test(m.body ?? '')).body;
  const linkId = linkBody.match(/\/pay\/(plink_sim_[a-z0-9-]+)/i)[1];

  const paid = await fetch(`${baseUrl}/v1/pay/${linkId}/pay`, { method: 'POST' });
  if (!paid.ok) throw new Error(`simulated payment returned ${paid.status}`);

  await waitFor(
    (messages) =>
      messages.some((m) => /Receipt/.test(m.body ?? '')) &&
      messages.some((m) => /Print Ready/i.test(m.body ?? '')),
    'paid → printing → ready sequence',
    10000
  );
  await whatsAppWebhookHandler.waitForIdle();

  const transcript = mockWhatsAppProvider.outbound.slice(outboundStart);
  console.log('\n=== Chhaap WhatsApp mock transcript ===\n');
  for (const [index, message] of transcript.entries()) {
    const body = message.body
      ? message.body.replace(/\n/g, '\n    ')
      : message.templateName
        ? `[template ${message.templateName}] ${JSON.stringify(message.params)}`
        : `[${message.type}]`;
    console.log(`${String(index + 1).padStart(2, '0')}. → ${message.to}  ${body}\n`);
  }
  console.log('=== End transcript ===');
  console.log(`Agent dispatches: ${agent.dispatches.length}`);
  console.log(`Payment link: ${linkId}`);
  console.log('No Meta or Razorpay account was contacted.\n');

  agent.close();
  await app.close();
  await fs.rm(dataDir, { recursive: true, force: true });
}

main().catch(async (error) => {
  console.error('[demo:whatsapp] failed:', error);
  await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  process.exit(1);
});
