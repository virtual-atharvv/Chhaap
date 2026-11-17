import type { FastifyRequest, FastifyReply } from 'fastify';
import type { DatabaseRepository } from '@chhaap/db';
export declare class WhatsAppWebhookHandler {
    private processing;
    private queue;
    private database;
    /** Test seam: lets tests swap the repository without rebuilding module state. */
    setDatabase(database: DatabaseRepository): void;
    handleVerification(req: FastifyRequest, reply: FastifyReply): FastifyReply<import("fastify").RawServerDefault, import("http").IncomingMessage, import("http").ServerResponse<import("http").IncomingMessage>, import("fastify").RouteGenericInterface, unknown, import("fastify").FastifySchema, import("fastify").FastifyTypeProviderDefault, unknown>;
    /** Verifies X-Hub-Signature-256 over the exact raw request bytes. */
    verifySignature(rawBody: string | Buffer, signatureHeader: string | undefined): boolean;
    /**
     * Meta requires a fast acknowledgement. We verify, acknowledge with 200 and
     * process the payload on a serial queue. Tests can await `waitForIdle()`.
     */
    handleInbound(req: FastifyRequest, reply: FastifyReply): Promise<never>;
    waitForIdle(): Promise<void>;
    private processPayload;
    private processMessage;
}
export declare const whatsAppWebhookHandler: WhatsAppWebhookHandler;
//# sourceMappingURL=webhook.d.ts.map