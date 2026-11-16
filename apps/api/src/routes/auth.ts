import type { FastifyPluginAsync } from 'fastify';
import { db } from '@chhaap/db';
import { RequestOtpSchema, VerifyOtpSchema, generateSixDigitCode } from '@chhaap/shared';
import {
  clearAuthCookies,
  readCookie,
  requireShopAuth,
  setAuthCookies,
  verifyJwt
} from '../auth.js';
import { loadConfig } from '../config.js';
import { getWhatsAppProvider } from '../whatsapp/index.js';
import { clientIp, enforceRateLimit, limiters } from '../rate-limit.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  const config = loadConfig();

  app.post('/v1/auth/otp/request', async (req, reply) => {
    const parsed = RequestOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.errors[0]?.message ?? 'Invalid phone' });
    }
    const { phone } = parsed.data;

    if (!enforceRateLimit(req, reply, limiters.otpPhone, `otp:phone:${phone}`)) return;
    if (!enforceRateLimit(req, reply, limiters.otpIp, `otp:ip:${clientIp(req)}`)) return;

    const user = await db.getUserByPhone(phone);
    // Generic response prevents account enumeration. No OTP is created or
    // sent when the phone is not registered as owner/staff.
    if (!user || (user.role !== 'owner' && user.role !== 'staff')) {
      return { success: true, message: 'If this number is registered, an OTP has been sent.' };
    }

    const code = generateSixDigitCode();
    const { expiresAt } = await db.createOtp(phone, code, config.otpPepper);

    try {
      const provider = getWhatsAppProvider();
      await provider.sendTemplate(phone, 'shop_login_otp', 'en', [code]);
    } catch (err) {
      console.warn('[Auth] Could not send OTP template:', (err as Error).message);
    }

    if (config.whatsappMode === 'mock') {
      // Never printed in cloud/production mode.
      console.log(`[Mock WhatsApp OTP] Login code for ${phone}: ${code}`);
    }

    return {
      success: true,
      message: 'If this number is registered, an OTP has been sent.',
      expiresAt: expiresAt.toISOString()
    };
  });

  app.post('/v1/auth/otp/verify', async (req, reply) => {
    const parsed = VerifyOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });
    }
    const { phone, code } = parsed.data;

    if (!enforceRateLimit(req, reply, limiters.otpVerifyPhone, `otp:verify:${phone}`)) return;

    const result = await db.verifyOtp(phone, code, config.otpPepper);
    if (!result.valid) {
      return reply.code(401).send({ error: result.error ?? 'Invalid OTP' });
    }

    const user = await db.getUserByPhone(phone);
    if (!user) return reply.code(401).send({ error: 'Invalid OTP' });

    const shop =
      (await db.getShopByOwnerId(user.id)) ??
      (user.phone ? await db.getShopByOwnerId(user.id) : undefined);
    if (!shop) {
      return reply.code(403).send({ error: 'No shop is linked to this account' });
    }

    const authUser = { userId: user.id, role: user.role, shopId: shop.id } as const;
    const tokens = await setAuthCookies(reply, authUser, config);

    return {
      success: true,
      token: tokens.accessToken,
      user: { id: user.id, name: user.name, role: user.role },
      shop: { id: shop.id, slug: shop.slug, name: shop.name }
    };
  });

  app.post('/v1/auth/refresh', async (req, reply) => {
    const token = readCookie(req, 'chhaap_refresh');
    if (!token) return reply.code(401).send({ error: 'No refresh token' });

    const result = await db.consumeRefreshToken(token, config.refreshTokenPepper);
    if (!result.valid || !result.userId) {
      return reply.code(401).send({ error: result.error ?? 'Invalid refresh token' });
    }

    const user = await db.getUserById(result.userId);
    if (!user) return reply.code(401).send({ error: 'User not found' });
    const shop = await db.getShopByOwnerId(user.id);
    if (!shop) return reply.code(403).send({ error: 'No shop linked to this account' });

    const tokens = await setAuthCookies(
      reply,
      { userId: user.id, role: user.role, shopId: shop.id },
      config
    );
    return { success: true, token: tokens.accessToken };
  });

  app.post('/v1/auth/logout', async (_req, reply) => {
    clearAuthCookies(reply);
    return { success: true };
  });

  app.get('/v1/auth/me', async (req, reply) => {
    const user = await requireShopAuth(req, reply);
    if (!user) return;
    const shop = await db.getShopById(user.shopId);
    return { user, shop };
  });

  // Bearer-token variant used by native clients and tests. This is the same
  // signed JWT, never a long-lived shared secret.
  app.post('/v1/auth/token/verify', async (req, reply) => {
    const body = req.body as { token?: string };
    if (!body?.token) return reply.code(400).send({ error: 'token required' });
    const decoded = verifyJwt(body.token, config.jwtSecret);
    if (!decoded) return reply.code(401).send({ error: 'Invalid token' });
    return { valid: true, user: decoded };
  });
};
