import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import WebSocket from 'ws';

const execFileAsync = promisify(execFile);

/** Reads JSON from a fetch Response without leaking `unknown` into tests. */
export async function readJson(res: Response): Promise<any> {
  return res.json();
}

export async function waitFor<T>(
  fn: () => Promise<T | undefined | false> | T | undefined | false,
  description: string,
  timeoutMs = 8000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value as T;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(
    `Timed out waiting for ${description}${lastError ? `: ${(lastError as Error).message}` : ''}`
  );
}

/** Generates a small real PDF (2 pages) with Ghostscript. */
export async function makeTestPdf(dir: string): Promise<Buffer> {
  await fs.mkdir(dir, { recursive: true });
  const psPath = path.join(dir, 'sample.ps');
  const pdfPath = path.join(dir, 'sample.pdf');
  const postscript = [
    '%!PS',
    '/Helvetica findfont 28 scalefont setfont',
    '1 0 0 setrgbcolor',
    '72 720 moveto (Colour page) show',
    'showpage',
    '0 0 0 setrgbcolor',
    '72 720 moveto (Black and white page) show',
    'showpage'
  ].join('\n');
  await fs.writeFile(psPath, postscript);
  await execFileAsync('gs', [
    '-q',
    '-dNOPAUSE',
    '-dBATCH',
    '-sDEVICE=pdfwrite',
    `-sOutputFile=${pdfPath}`,
    psPath
  ]);
  const buffer = await fs.readFile(pdfPath);
  await fs.unlink(psPath).catch(() => {});
  await fs.unlink(pdfPath).catch(() => {});
  return buffer;
}

export async function uploadFile(
  baseUrl: string,
  buffer: Buffer,
  filename: string,
  type = 'application/pdf'
): Promise<{ status: number; data: any }> {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type }), filename);
  const res = await fetch(`${baseUrl}/v1/uploads`, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

export async function createWebOrder(
  baseUrl: string,
  fileId: string,
  settings: Record<string, unknown> = {},
  options: { phone?: string; consent?: boolean; key?: string } = {}
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${baseUrl}/v1/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      shopSlug: 'campus-xerox',
      fileId,
      settings,
      idempotencyKey: options.key ?? `test-${crypto.randomUUID()}`,
      ...(options.phone
        ? { customerPhone: options.phone, customerPhoneConsent: options.consent !== false }
        : {})
    })
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

export interface DispatchMessage {
  type: 'job.dispatch';
  jobId: string;
  fileUrl: string;
  sha256: string;
  pageCount: number;
  settings: any;
  printerSystemName: string;
  documentName: string;
}

type AgentMode = 'ok' | 'hash_mismatch';

/** Records gateway messages and, by default, completes each job correctly. */
export class FakeAgent {
  ws: WebSocket | null = null;
  ack: any = null;
  dispatches: DispatchMessage[] = [];
  sent: any[] = [];
  mode: AgentMode = 'ok';
  autoRespond = true;
  private counter = 0;

  constructor(
    private readonly url: string,
    private readonly identity: { agentId?: string; token?: string; version?: string } = {}
  ) {}

  async connect(printers = [
    {
      systemName: 'PDF',
      displayName: 'Virtual PDF',
      color: true,
      duplex: true,
      papers: ['A4', 'A3', 'Legal']
    }
  ]): Promise<void> {
    this.ws = new WebSocket(this.url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('agent connect timeout')), 5000);
      this.ws!.on('open', () => {
        this.send({
          type: 'hello',
          agentId: this.identity.agentId ?? 'agent-campus-1',
          token: this.identity.token ?? 'test_agent_secret_token_123',
          version: this.identity.version ?? '0.2.0',
          os: 'linux-test',
          printers
        });
      });
      this.ws!.on('message', (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.type === 'ack') {
          this.ack = message;
          clearTimeout(timer);
          resolve();
        }
        if (message.type === 'job.dispatch') {
          this.dispatches.push(message);
          if (this.autoRespond) void this.respond(message);
        }
      });
      this.ws!.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private async respond(message: DispatchMessage): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (this.mode === 'hash_mismatch') {
      this.send({
        type: 'job.result',
        jobId: message.jobId,
        ok: false,
        pagesPrinted: 0,
        error: 'hash_mismatch: integration test'
      });
      return;
    }
    this.send({ type: 'job.accepted', jobId: message.jobId });
    this.send({ type: 'job.progress', jobId: message.jobId, state: 'printing', pagesPrinted: message.pageCount });
    await new Promise((resolve) => setTimeout(resolve, 15));
    this.send({
      type: 'job.result',
      jobId: message.jobId,
      ok: true,
      pagesPrinted: message.pageCount * (message.settings.copies || 1)
    });
  }

  send(message: Record<string, unknown>): void {
    this.sent.push(message);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  async close(): Promise<void> {
    if (!this.ws) return;
    const ws = this.ws;
    this.ws = null;
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
      await new Promise((resolve) => {
        ws.once('close', resolve);
        setTimeout(resolve, 1000);
      });
    }
  }
}

let waCounter = 0;

export function resetWaCounter(): void {
  waCounter = 0;
}

export function waMessage(message: Record<string, unknown>, profileName = 'Test Customer'): string {
  const waId = String(message.from ?? '919876543210');
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-test',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '919876543210',
                phone_number_id: 'phone-test'
              },
              contacts: [{ profile: { name: profileName }, wa_id: waId }],
              messages: [{ timestamp: String(Math.floor(Date.now() / 1000)), ...message }]
            }
          }
        ]
      }
    ]
  });
}

export function waText(from: string, body: string, wamid?: string): Record<string, unknown> {
  return {
    from,
    id: wamid ?? `wamid.test.${Date.now()}.${++waCounter}`,
    type: 'text',
    text: { body }
  };
}

export function waButton(from: string, id: string, title: string, wamid?: string): Record<string, unknown> {
  return {
    from,
    id: wamid ?? `wamid.test.${Date.now()}.${++waCounter}`,
    type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id, title } }
  };
}

export function waDocument(
  from: string,
  mediaId: string,
  filename = 'assignment.pdf',
  wamid?: string
): Record<string, unknown> {
  return {
    from,
    id: wamid ?? `wamid.test.${Date.now()}.${++waCounter}`,
    type: 'document',
    document: {
      id: mediaId,
      mime_type: 'application/pdf',
      filename,
      sha256: 'mock-media-sha'
    }
  };
}

export function signWhatsApp(raw: string, secret = process.env.WHATSAPP_APP_SECRET || 'chhaap_wa_app_secret_dev'): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
}

export async function postWhatsApp(
  baseUrl: string,
  rawBody: string,
  options: { signature?: string; secret?: string } = {}
): Promise<Response> {
  return fetch(`${baseUrl}/v1/webhooks/whatsapp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': options.signature ?? signWhatsApp(rawBody, options.secret)
    },
    body: rawBody
  });
}

export function rupeeTotal(body: string): number {
  const match = body.match(/Total(?: Amount)?: ₹([0-9]+(?:\.[0-9]{1,2})?)/);
  assert.ok(match, `expected a rupee total in: ${body}`);
  return Math.round(parseFloat(match[1]!) * 100);
}
