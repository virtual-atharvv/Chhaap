export class MockWhatsAppProvider {
    outbound = [];
    mediaStore = new Map();
    reset() {
        this.outbound = [];
        this.mediaStore.clear();
    }
    registerMockMedia(mediaId, buffer, mime, filename) {
        this.mediaStore.set(mediaId, { buffer, mime, filename });
    }
    async sendText(to, body) {
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
    async sendButtons(to, body, buttons) {
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
    async sendList(to, body, buttonLabel, rows) {
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
    async sendDocument(to, urlOrId, filename, caption) {
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
    async sendTemplate(to, templateName, lang, params) {
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
    async downloadMedia(mediaId) {
        const media = this.mediaStore.get(mediaId);
        if (!media) {
            throw new Error(`Media ID ${mediaId} not found in mock store`);
        }
        return media;
    }
    async markRead(messageId) {
        // No-op for mock
    }
    getLastMessageFor(phone) {
        return [...this.outbound].reverse().find((m) => m.to === phone);
    }
}
export const mockWhatsAppProvider = new MockWhatsAppProvider();
//# sourceMappingURL=mock-provider.js.map