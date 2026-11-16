import type { FastifyRequest, FastifyReply } from 'fastify';
import { loadConfig } from './config.js';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Small in-process fixed-window limiter. Good enough for a single-node pilot;
 * move to Redis when the API runs on more than one box.
 */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  check(key: string): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
    const now = Date.now();
    this.sweep(now);

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.limit - 1, retryAfterSeconds: 0 };
    }

    if (bucket.count >= this.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      };
    }

    bucket.count++;
    return { allowed: true, remaining: this.limit - bucket.count, retryAfterSeconds: 0 };
  }

  reset(key?: string): void {
    if (key) this.buckets.delete(key);
    else this.buckets.clear();
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

/** Exported for tests to reset state between cases. */
export const limiters = {
  uploadIp: new RateLimiter(20, 60_000),
  orderIp: new RateLimiter(30, 60_000),
  checkoutIp: new RateLimiter(30, 60_000),
  otpPhone: new RateLimiter(5, 10 * 60_000),
  otpIp: new RateLimiter(20, 10 * 60_000),
  otpVerifyPhone: new RateLimiter(10, 10 * 60_000),
  waInbound: new RateLimiter(30, 60_000),
  agentPair: new RateLimiter(10, 10 * 60_000),
  webhookIp: new RateLimiter(300, 60_000)
};

export function clientIp(req: FastifyRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || 'unknown';
}

/** Returns true when the request may continue. Sends 429 otherwise. */
export function enforceRateLimit(
  req: FastifyRequest,
  reply: FastifyReply,
  limiter: RateLimiter,
  key: string
): boolean {
  const config = loadConfig();
  if (!config.rateLimitEnabled) return true;
  const result = limiter.check(key);
  if (!result.allowed) {
    reply
      .code(429)
      .header('Retry-After', String(result.retryAfterSeconds))
      .send({ error: 'Too many requests. Please slow down and try again.', retryAfter: result.retryAfterSeconds });
    return false;
  }
  return true;
}

/**
 * Optional Cloudflare Turnstile verification hook (A10). Feature-flagged: if
 * TURNSTILE_SECRET is unset the check is skipped. Never blocks local dev.
 */
export async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  const config = loadConfig();
  if (!config.turnstileSecret) return true;
  if (!token) return false;

  try {
    const body = new URLSearchParams({
      secret: config.turnstileSecret,
      response: token,
      remoteip: ip
    });
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body
    });
    const data = (await res.json()) as { success?: boolean };
    return Boolean(data.success);
  } catch {
    return false;
  }
}
