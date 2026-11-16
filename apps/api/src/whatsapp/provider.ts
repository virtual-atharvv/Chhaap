export interface ButtonOption {
  id: string;
  title: string;
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export interface WhatsAppProvider {
  sendText(to: string, body: string): Promise<{ messageId: string }>;
  sendButtons(to: string, body: string, buttons: ButtonOption[]): Promise<{ messageId: string }>;
  sendList(to: string, body: string, buttonLabel: string, rows: ListRow[]): Promise<{ messageId: string }>;
  sendDocument(to: string, urlOrId: string, filename: string, caption?: string): Promise<{ messageId: string }>;
  sendTemplate(to: string, templateName: string, lang: string, params: any[]): Promise<{ messageId: string }>;
  downloadMedia(mediaId: string): Promise<{ buffer: Buffer; mime: string; filename?: string }>;
  markRead(messageId: string): Promise<void>;
}
