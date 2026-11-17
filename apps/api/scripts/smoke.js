#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(apiDir, '../..');

const timeoutMs = 20_000;
const deadline = Date.now() + timeoutMs;

console.log('[Smoke] Starting API server on ephemeral port...');

const child = spawn(process.execPath, [path.join(apiDir, 'dist/index.js')], {
  cwd: repoRoot,
  env: {
    ...process.env,
    PORT: '0',
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    DB_MODE: 'memory',
    PAYMENTS_MODE: 'simulated',
    WHATSAPP_MODE: 'mock',
    JWT_SECRET: 'smoke_test_jwt_secret_at_least_32_chars_long',
    RAZORPAY_WEBHOOK_SECRET: 'smoke_test_webhook_secret',
    LOG_LEVEL: 'info'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let baseUrl = '';

child.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  // Match http://127.0.0.1:<port> or http://localhost:<port>
  const match = text.match(/http:\/\/(127\.0\.0\.1|localhost):(\d+)/);
  if (match && !baseUrl) {
    baseUrl = `http://127.0.0.1:${match[2]}`;
    console.log(`[Smoke] Detected server running at ${baseUrl}`);
  }
});

child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
});

child.on('error', (err) => {
  console.error('[Smoke] Child process failed:', err);
  process.exit(1);
});

async function pollProbes() {
  while (Date.now() < deadline) {
    if (baseUrl) {
      try {
        const [healthRes, readyRes] = await Promise.all([
          fetch(`${baseUrl}/healthz`).catch(() => null),
          fetch(`${baseUrl}/readyz`).catch(() => null)
        ]);

        if (healthRes && healthRes.status === 200 && readyRes && readyRes.status === 200) {
          const healthJson = await healthRes.json().catch(() => ({}));
          const readyJson = await readyRes.json().catch(() => ({}));

          if (healthJson.status === 'ok' && readyJson.database === 'connected') {
            console.log('[Smoke] Verification successful: /healthz=200 ok, /readyz=200 connected');
            return true;
          }
        }
      } catch {
        // Retry
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

const ok = await pollProbes();

// Shutdown cleanly
child.kill('SIGTERM');

await new Promise((resolve) => {
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    resolve(null);
  }, 3000);
  child.on('exit', () => {
    clearTimeout(timer);
    resolve(null);
  });
});

if (!ok) {
  console.error('[Smoke] Timed out waiting for /healthz and /readyz (20s)');
  process.exit(1);
}

console.log('[Smoke] PASS: API booted and passed health checks cleanly.');
process.exit(0);
