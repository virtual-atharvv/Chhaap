import type { ButtonOption, ListRow, WhatsAppProvider } from './provider.js';
export interface OutboundMessage {
    id: string;
    to: string;
    type: 'text' | 'buttons' | 'list' | 'document' | 'template';
    body?: string;
    buttons?: ButtonOption[];
    rows?: ListRow[];
    templateName?: string;
    params?: any[];
    timestamp: number;
}
export declare class MockWhatsAppProvider implements WhatsAppProvider {
    outbound: OutboundMessage[];
    mediaStore: Map<string, {
        buffer: Buffer;
        mime: string;
        filename?: string;
    }>;
    reset(): void;
    registerMockMedia(mediaId: string, buffer: Buffer, mime: string, filename?: string): void;
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
    sendTemplate(to: string, templateName: string, lang: string, params: any[]): Promise<{
        messageId: string;
    }>;
    downloadMedia(mediaId: string): Promise<{
        buffer: Buffer;
        mime: string;
        filename?: string;
    }>;
    markRead(messageId: string): Promise<void>;
    getLastMessageFor(phone: string): OutboundMessage | undefined;
}
export declare const mockWhatsAppProvider: MockWhatsAppProvider;
//# sourceMappingURL=mock-provider.d.ts.map