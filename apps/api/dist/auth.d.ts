import type { FastifyRequest, FastifyReply } from 'fastify';
export interface AuthUser {
    userId: string;
    role: 'owner' | 'staff' | 'admin';
    shopId: string;
}
export declare const ACCESS_TOKEN_TTL_SECONDS: number;
export declare const REFRESH_TOKEN_TTL_SECONDS: number;
export declare function signJwt(payload: AuthUser, secret: string, expiresInSeconds?: number): string;
export declare function verifyJwt(token: string, secret: string): AuthUser | null;
export declare function extractToken(req: FastifyRequest): string | undefined;
/** Parses the Cookie header without an external plugin. */
export declare function readCookie(req: FastifyRequest, name: string): string | undefined;
/**
 * Resolves a shop user from the access token. Returns null and sends 401 when
 * the token is missing/invalid. All shop data access must use `user.shopId`
 * from this token, never a slug/id supplied in the URL or body.
 */
export declare function requireShopAuth(req: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null>;
export declare function requireRole(user: AuthUser | null, roles: AuthUser['role'][]): boolean;
export declare function setAuthCookies(reply: FastifyReply, user: AuthUser, config?: import("./config.js").AppConfig): Promise<{
    accessToken: string;
    refreshToken: string;
}>;
export declare function clearAuthCookies(reply: FastifyReply): void;
//# sourceMappingURL=auth.d.ts.map