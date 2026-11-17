import crypto from 'node:crypto';
import { db } from '@chhaap/db';
import { loadConfig } from './config.js';
export const ACCESS_TOKEN_TTL_SECONDS = 30 * 60; // short-lived access token
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 86400;
function base64url(input) {
    return Buffer.from(input).toString('base64url');
}
export function signJwt(payload, secret, expiresInSeconds = ACCESS_TOKEN_TTL_SECONDS) {
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const now = Math.floor(Date.now() / 1000);
    const body = base64url(JSON.stringify({
        ...payload,
        iat: now,
        exp: now + expiresInSeconds,
        jti: crypto.randomBytes(12).toString('hex')
    }));
    const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${signature}`;
}
export function verifyJwt(token, secret) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3)
            return null;
        const [header, body, signature] = parts;
        const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf-8'));
        if (parsedHeader.alg !== 'HS256')
            return null;
        const expected = crypto
            .createHmac('sha256', secret)
            .update(`${header}.${body}`)
            .digest('base64url');
        const a = Buffer.from(signature);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
            return null;
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
        if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
            return null;
        }
        if (!payload.userId || !payload.role || !payload.shopId)
            return null;
        return {
            userId: payload.userId,
            role: payload.role,
            shopId: payload.shopId
        };
    }
    catch {
        return null;
    }
}
export function extractToken(req) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer '))
        return authHeader.slice(7).trim();
    return readCookie(req, 'chhaap_token');
}
/** Parses the Cookie header without an external plugin. */
export function readCookie(req, name) {
    const header = req.headers.cookie;
    if (!header)
        return req.cookies?.[name];
    for (const part of header.split(';')) {
        const index = part.indexOf('=');
        if (index < 0)
            continue;
        const key = part.slice(0, index).trim();
        if (key !== name)
            continue;
        try {
            return decodeURIComponent(part.slice(index + 1).trim());
        }
        catch {
            return part.slice(index + 1).trim();
        }
    }
    return undefined;
}
function serializeCookie(name, value, options) {
    const parts = [
        `${name}=${encodeURIComponent(value)}`,
        `Path=${options.path}`,
        `Max-Age=${options.maxAgeSeconds}`,
        'SameSite=Lax'
    ];
    if (options.httpOnly !== false)
        parts.push('HttpOnly');
    if (options.secure)
        parts.push('Secure');
    return parts.join('; ');
}
/**
 * Resolves a shop user from the access token. Returns null and sends 401 when
 * the token is missing/invalid. All shop data access must use `user.shopId`
 * from this token, never a slug/id supplied in the URL or body.
 */
export async function requireShopAuth(req, reply) {
    const config = loadConfig();
    const token = extractToken(req);
    if (!token) {
        reply.code(401).send({ error: 'Authentication required. Please sign in.' });
        return null;
    }
    const user = verifyJwt(token, config.jwtSecret);
    if (!user) {
        reply.code(401).send({ error: 'Invalid or expired session. Please sign in again.' });
        return null;
    }
    req.user = user;
    return user;
}
export function requireRole(user, roles) {
    return Boolean(user && roles.includes(user.role));
}
export async function setAuthCookies(reply, user, config = loadConfig()) {
    const accessToken = signJwt(user, config.jwtSecret);
    const refreshToken = crypto.randomBytes(48).toString('hex');
    await db.createRefreshToken(user.userId, refreshToken, config.refreshTokenPepper, REFRESH_TOKEN_TTL_SECONDS);
    const secure = config.nodeEnv === 'production';
    reply.header('set-cookie', [
        serializeCookie('chhaap_token', accessToken, {
            path: '/',
            maxAgeSeconds: ACCESS_TOKEN_TTL_SECONDS,
            secure
        }),
        serializeCookie('chhaap_refresh', refreshToken, {
            path: '/v1/auth',
            maxAgeSeconds: REFRESH_TOKEN_TTL_SECONDS,
            secure
        })
    ]);
    return { accessToken, refreshToken };
}
export function clearAuthCookies(reply) {
    reply.header('set-cookie', [
        serializeCookie('chhaap_token', '', { path: '/', maxAgeSeconds: 0, secure: false }),
        serializeCookie('chhaap_refresh', '', { path: '/v1/auth', maxAgeSeconds: 0, secure: false })
    ]);
}
//# sourceMappingURL=auth.js.map