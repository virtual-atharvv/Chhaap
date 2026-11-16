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

export class MockWhatsAppProvider implements WhatsAppProvider {
  public outbound: OutboundMessage[] = [];
  public mediaStore = new Map<string, { buffer: Buffer; mime: string; filename?: string }>();

  reset() {
    this.outbound = [];
    this.mediaStore.clear();
  }

  registerMockMedia(mediaId: string, buffer: Buffer, mime: string, filename?: string) {
    this.mediaStore.set(mediaId, { buffer, mime, filename });
  }

  async sendText(to: string, body: string): Promise<{ messageId: string }> {
    const messageId = `wamid.mock.${Date.now()}.${Math.random().toString(36).substring(2, 7)}`;
    this.outbound.push({
      id: messageId,
      to,
      type: 'text',
      body,
      timestamp: Date.now()
    });
    return { messageId };
  }

  async sendButtons(to: string, body: string, buttons: ButtonOption[]): Promise<{ messageId: string }> {
    // Enforcement: max 3 buttons, title <= 20 chars
    const trimmedButtons = buttons.slice(0, 3).map((b) => ({
      id: b.id,
      title: b.title.slice(0, 20)
    }));

    const messageId = `wamid.mock.${Date.now()}.${Math.random().toString(36).substring(2, 7)}`;
    this.outbound.push({
      id: messageId,
      to,
      type: 'buttons',
      body,
      buttons: trimmedButtons,
      timestamp: Date.now()
    });
    return { messageId };
  }

  async sendList(to: string, body: string, buttonLabel: string, rows: ListRow[]): Promise<{ messageId: string }> {
    const messageId = `wamid.mock.${Date.now()}.${Math.random().toString(36).substring(2, 7)}`;
    this.outbound.push({
      id: messageId,
      to,
      type: 'list',
      body: `${body} [${buttonLabel}]`,
      rows: rows.slice(0, 10),
      timestamp: Date.now()
    });
    return { messageId };
  }

  async sendDocument(to: string, urlOrId: string, filename: string, caption?: string): Promise<{ messageId: string }> {
    const messageId = `wamid.mock.${Date.now()}.${Math.random().toString(36).substring(2, 7)}`;
    this.outbound.push({
      id: messageId,
      to,
      type: 'document',
      body: caption,
      timestamp: Date.now()
    });
    return { messageId };
  }

  async sendTemplate(to: string, templateName: string, lang: string, params: any[]): Promise<{ messageId: string }> {
    const messageId = `wamid.mock.${Date.now()}.${Math.random().toString(36).substring(2, 7)}`;
    this.outbound.push({
      id: messageId,
      to,
      type: 'template',
      templateName,
      params,
      timestamp: Date.now()
    });
    return { messageId };
  }

  async downloadMedia(mediaId: string): Promise<{ buffer: Buffer; mime: string; filename?: string }> {
    const media = this.mediaStore.get(mediaId);
    if (!media) {
      throw new Error(`Media ID ${mediaId} not found in mock store`);
    }
    return media;
  }

  async markRead(messageId: string): Promise<void> {
    // No-op for mock
  }

  getLastMessageFor(phone: string): OutboundMessage | undefined {
    return [...this.outbound].reverse().find((m) => m.to === phone);
  }
}

export const mockWhatsAppProvider = new MockWhatsAppProvider();
