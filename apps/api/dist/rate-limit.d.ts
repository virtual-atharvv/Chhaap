import type { FastifyRequest, FastifyReply } from 'fastify';
/**
 * Small in-process fixed-window limiter. Good enough for a single-node pilot;
 * move to Redis when the API runs on more than one box.
 */
export declare class RateLimiter {
    private readonly limit;
    private readonly windowMs;
    private buckets;
    private lastSweep;
    constructor(limit: number, windowMs: number);
    check(key: string): {
        allowed: boolean;
        remaining: number;
        retryAfterSeconds: number;
    };
    reset(key?: string): void;
    private sweep;
}
/** Exported for tests to reset state between cases. */
export declare const limiters: {
    uploadIp: RateLimiter;
    orderIp: RateLimiter;
    checkoutIp: RateLimiter;
    otpPhone: RateLimiter;
    otpIp: RateLimiter;
    otpVerifyPhone: RateLimiter;
    waInbound: RateLimiter;
    agentPair: RateLimiter;
    webhookIp: RateLimiter;
};
export declare function clientIp(req: FastifyRequest): string;
/** Returns true when the request may continue. Sends 429 otherwise. */
export declare function enforceRateLimit(req: FastifyRequest, reply: FastifyReply, limiter: RateLimiter, key: string): boolean;
/**
 * Optional Cloudflare Turnstile verification hook (A10). Feature-flagged: if
 * TURNSTILE_SECRET is unset the check is skipped. Never blocks local dev.
 */
export declare function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean>;
//# sourceMappingURL=rate-limit.d.ts.map