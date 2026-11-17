export interface AppConfig {
    port: number;
    host: string;
    nodeEnv: string;
    paymentsMode: 'simulated' | 'razorpay';
    whatsappMode: 'mock' | 'cloud';
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
export declare function loadConfig(): AppConfig;
//# sourceMappingURL=config.d.ts.map