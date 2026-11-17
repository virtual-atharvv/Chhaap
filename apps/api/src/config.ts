import { loadEnv } from './env.js';

loadEnv();

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: string;
  paymentsMode: 'simulated' | 'razorpay';
  whatsappMode: 'mock' | 'cloud';
  scanMode: 'off' | 'clamav';
  officeUploads: 'enabled' | 'disabled';
  allowUnscannedPdfImages: boolean;
  jwtSecret: string;
  agentTokenPepper: string;
  otpPepper: string;
  refreshTokenPepper: string;
  razorpayKeyId: string;
  razorpayKeySecret: string;
  razorpayWebhookSecret: string;
  whatsappVerifyToken: string;
  whatsappAppSecret: string;
  whatsappAccessToken: string;
  whatsappPhoneNumberId: string;
  whatsappWabaId: string;
  whatsappApiVersion: string;
  whatsappPlatformNumber: string;
  publicBaseUrl: string;
  maxUploadBytes: number;
  maxPages: number;
  fileUrlTtlSeconds: number;
  webhookMaxAgeSeconds: number;
  rateLimitEnabled: boolean;
  turnstileSecret: string;
  sentryDsn: string;
  logLevel: string;
  waMessageRetentionDays: number;
  sessionTtlMinutes: number;
  paymentLinkTtlMinutes: number;
  orderExpiryMinutes: number;
  printerHeartbeatTimeoutMs: number;
}

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true' || value.toLowerCase() === 'yes';
}

function int(value: string | undefined, fallback: number): number {
  const parsed = parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const paymentsMode = (process.env.PAYMENTS_MODE || 'simulated') as 'simulated' | 'razorpay';
  const whatsappMode = (process.env.WHATSAPP_MODE || 'mock') as 'mock' | 'cloud';
  const scanMode = (process.env.SCAN_MODE || 'off') as 'off' | 'clamav';
  const officeUploads = (process.env.OFFICE_UPLOADS || 'disabled') as 'enabled' | 'disabled';
  const allowUnscannedPdfImages = bool(process.env.ALLOW_UNSCANNED_PDF_IMAGES, false);

  if (nodeEnv === 'production' && paymentsMode === 'simulated') {
    throw new Error('Fatal: Simulated payments cannot be enabled in production (PAYMENTS_MODE=simulated)');
  }

  if (nodeEnv === 'production' && whatsappMode === 'mock') {
    throw new Error('Fatal: WHATSAPP_MODE=mock is not allowed in production');
  }

  if (nodeEnv === 'production') {
    if (scanMode === 'off') {
      if (officeUploads === 'enabled' || !allowUnscannedPdfImages) {
        throw new Error(
          'Fatal: In production, SCAN_MODE=off is refused unless OFFICE_UPLOADS=disabled and ALLOW_UNSCANNED_PDF_IMAGES=true (conscious risk acceptance)'
        );
      }
    }
  }

  if (nodeEnv === 'production') {
    if (process.env.DB_MODE !== 'postgres' || !process.env.DATABASE_URL) {
      throw new Error(
        'Fatal: Production requires DB_MODE=postgres and a DATABASE_URL; the in-memory database is test-only'
      );
    }
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('change_in_production')) {
      throw new Error('Fatal: A strong JWT_SECRET is required in production');
    }
    if (!process.env.PUBLIC_BASE_URL) {
      throw new Error('Fatal: PUBLIC_BASE_URL is required in production');
    }
  }

  if (whatsappMode === 'cloud') {
    const missing: string[] = [];
    if (!process.env.WHATSAPP_ACCESS_TOKEN) missing.push('WHATSAPP_ACCESS_TOKEN');
    if (!process.env.WHATSAPP_PHONE_NUMBER_ID) missing.push('WHATSAPP_PHONE_NUMBER_ID');
    if (!process.env.WHATSAPP_APP_SECRET) missing.push('WHATSAPP_APP_SECRET');
    if (!process.env.WHATSAPP_VERIFY_TOKEN) missing.push('WHATSAPP_VERIFY_TOKEN');
    if (!process.env.WHATSAPP_PLATFORM_NUMBER) missing.push('WHATSAPP_PLATFORM_NUMBER');
    if (missing.length > 0) {
      throw new Error(`Fatal: WhatsApp Cloud API mode requires env vars: ${missing.join(', ')}`);
    }
  }

  if (paymentsMode === 'razorpay' && nodeEnv === 'production') {
    const missing: string[] = [];
    if (!process.env.RAZORPAY_KEY_ID) missing.push('RAZORPAY_KEY_ID');
    if (!process.env.RAZORPAY_KEY_SECRET) missing.push('RAZORPAY_KEY_SECRET');
    if (!process.env.RAZORPAY_WEBHOOK_SECRET) missing.push('RAZORPAY_WEBHOOK_SECRET');
    if (missing.length > 0) {
      throw new Error(`Fatal: Razorpay production mode requires env vars: ${missing.join(', ')}`);
    }
  }

  return {
    port: int(process.env.PORT, 4000),
    host: process.env.HOST || '0.0.0.0',
    nodeEnv,
    paymentsMode,
    whatsappMode,
    jwtSecret: process.env.JWT_SECRET || 'dev_jwt_secret_change_in_production_123',
    agentTokenPepper: process.env.AGENT_TOKEN_PEPPER || 'dev_agent_pepper',
    otpPepper: process.env.OTP_PEPPER || 'dev_otp_pepper',
    refreshTokenPepper: process.env.REFRESH_TOKEN_PEPPER || 'dev_refresh_pepper',
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_dummy_key_id',
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || 'rzp_test_dummy_key_secret',
    razorpayWebhookSecret:
      process.env.RAZORPAY_WEBHOOK_SECRET || 'rzp_test_webhook_secret_key_123',
    whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'chhaap_wa_verify_token_dev',
    whatsappAppSecret: process.env.WHATSAPP_APP_SECRET || 'chhaap_wa_app_secret_dev',
    whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    whatsappWabaId: process.env.WHATSAPP_WABA_ID || '',
    whatsappApiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
    whatsappPlatformNumber: process.env.WHATSAPP_PLATFORM_NUMBER || '919876543210',
    publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${int(process.env.PORT, 4000)}`,
    maxUploadBytes: int(process.env.MAX_UPLOAD_MB, 50) * 1024 * 1024,
    maxPages: int(process.env.MAX_PAGES, 500),
    fileUrlTtlSeconds: int(process.env.FILE_URL_TTL_SECONDS, 300),
    webhookMaxAgeSeconds: int(process.env.WEBHOOK_MAX_AGE_SECONDS, 900),
    rateLimitEnabled: bool(process.env.RATE_LIMIT_ENABLED, true),
    turnstileSecret: process.env.TURNSTILE_SECRET || '',
    sentryDsn: process.env.SENTRY_DSN || '',
    logLevel: process.env.LOG_LEVEL || (nodeEnv === 'test' ? 'silent' : 'info'),
    waMessageRetentionDays: int(process.env.WA_MESSAGE_RETENTION_DAYS, 30),
    sessionTtlMinutes: int(process.env.WA_SESSION_TTL_MINUTES, 30),
    paymentLinkTtlMinutes: int(process.env.PAYMENT_LINK_TTL_MINUTES, 15),
    orderExpiryMinutes: int(process.env.ORDER_EXPIRY_MINUTES, 15),
    printerHeartbeatTimeoutMs: int(process.env.PRINTER_HEARTBEAT_TIMEOUT_MS, 60000)
  };
}
