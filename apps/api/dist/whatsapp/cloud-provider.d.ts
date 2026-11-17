import type { ButtonOption, ListRow, WhatsAppProvider } from './provider.js';
/**
 * Meta WhatsApp Business Cloud API provider. The implementation is complete
 * but live calls are UNVERIFIED until the founder supplies credentials and an
 * approved number/template set; all versions and IDs are configuration-driven.
 */
export declare class CloudApiWhatsAppProvider implements WhatsAppProvider {
    private get config();
    private get baseUrl();
    private graphFetch;
    private postJson;
    sendText(to: string, body: string): Promise<{
        messageId: string;
    }>;
    sendButtons(to: string, body: string, buttons: ButtonOption[]): Promise<{
        messageId: string;
    }>;
    sendList(to: string, body: string, buttonLabel: string, rows: ListRow[]): Promise<{
        messageId: string;
    }>;
    sendDocument(to: string, urlOrId: string, filename: string, caption?: string): Promise<{
        messageId: string;
    }>;
    sendTemplate(to: string, templateName: string, lang: string, params: unknown[]): Promise<{
        messageId: string;
    }>;
    downloadMedia(mediaId: string): Promise<{
        buffer: Buffer;
        mime: string;
        filename?: string;
    }>;
    markRead(messageId: string): Promise<void>;
}
//# sourceMappingURL=cloud-provider.d.ts.map