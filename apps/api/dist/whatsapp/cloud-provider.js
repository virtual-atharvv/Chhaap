import { loadConfig } from '../config.js';
/**
 * Meta WhatsApp Business Cloud API provider. The implementation is complete
 * but live calls are UNVERIFIED until the founder supplies credentials and an
 * approved number/template set; all versions and IDs are configuration-driven.
 */
export class CloudApiWhatsAppProvider {
    get config() {
        return loadConfig();
    }
    get baseUrl() {
        return `https://graph.facebook.com/${this.config.whatsappApiVersion}/${this.config.whatsappPhoneNumberId}`;
    }
    async graphFetch(url, init, timeoutMs = 20_000) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetch(url, { ...init, signal: controller.signal });
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async postJson(endpoint, body) {
        const res = await this.graphFetch(`${this.baseUrl}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.config.whatsappAccessToken}`
            },
            body: JSON.stringify(body)
        });
        const text = await res.text();
        let data = {};
        try {
            data = text ? JSON.parse(text) : {};
        }
        catch {
            throw new Error(`WhatsApp Cloud API returned non-JSON (HTTP ${res.status})`);
        }
        if (!res.ok) {
            throw new Error(`WhatsApp Cloud API error (HTTP ${res.status}): ${data.error?.message ?? data.error?.type ?? 'unknown error'}`);
        }
        return data;
    }
    async sendText(to, body) {
        const res = await this.postJson('/messages', {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'text',
            text: { preview_url: false, body }
        });
        return { messageId: res.messages?.[0]?.id ?? '' };
    }
    async sendButtons(to, body, buttons) {
        if (buttons.length < 1 || buttons.length > 3) {
            throw new Error('WhatsApp buttons must contain between 1 and 3 options');
        }
        const res = await this.postJson('/messages', {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'interactive',
            interactive: {
                type: 'button',
                body: { text: body },
                action: {
                    buttons: buttons.map((b) => ({
                        type: 'reply',
                        reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) }
                    }))
                }
            }
        });
        return { messageId: res.messages?.[0]?.id ?? '' };
    }
    async sendList(to, body, buttonLabel, rows) {
        if (rows.length < 1 || rows.length > 10) {
            throw new Error('WhatsApp list rows must contain between 1 and 10 options');
        }
        const res = await this.postJson('/messages', {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'interactive',
            interactive: {
                type: 'list',
                body: { text: body },
                action: {
                    button: buttonLabel.slice(0, 20),
                    sections: [
                        {
                            rows: rows.map((r) => ({
                                id: r.id.slice(0, 200),
                                title: r.title.slice(0, 24),
                                ...(r.description ? { description: r.description.slice(0, 72) } : {})
                            }))
                        }
                    ]
                }
            }
        });
        return { messageId: res.messages?.[0]?.id ?? '' };
    }
    async sendDocument(to, urlOrId, filename, caption) {
        const isUrl = /^https?:\/\//i.test(urlOrId);
        const res = await this.postJson('/messages', {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'document',
            document: {
                ...(isUrl ? { link: urlOrId } : { id: urlOrId }),
                filename,
                ...(caption ? { caption } : {})
            }
        });
        return { messageId: res.messages?.[0]?.id ?? '' };
    }
    async sendTemplate(to, templateName, lang, params) {
        const res = await this.postJson('/messages', {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'template',
            template: {
                name: templateName,
                language: { code: lang },
                components: params.length
                    ? [
                        {
                            type: 'body',
                            parameters: params.map((p) => ({ type: 'text', text: String(p) }))
                        }
                    ]
                    : []
            }
        });
        return { messageId: res.messages?.[0]?.id ?? '' };
    }
    async downloadMedia(mediaId) {
        const metaRes = await this.graphFetch(`https://graph.facebook.com/${this.config.whatsappApiVersion}/${encodeURIComponent(mediaId)}`, { headers: { Authorization: `Bearer ${this.config.whatsappAccessToken}` } }, 15_000);
        if (!metaRes.ok) {
            throw new Error(`Could not retrieve WhatsApp media metadata (HTTP ${metaRes.status})`);
        }
        const meta = (await metaRes.json());
        if (!meta.url)
            throw new Error('WhatsApp media metadata did not include a download URL');
        if (meta.file_size && meta.file_size > this.config.maxUploadBytes) {
            throw new Error(`File exceeds the maximum allowed size of ${Math.round(this.config.maxUploadBytes / (1024 * 1024))} MB`);
        }
        const fileRes = await this.graphFetch(meta.url, { headers: { Authorization: `Bearer ${this.config.whatsappAccessToken}` } }, 60_000);
        if (!fileRes.ok) {
            throw new Error(`WhatsApp media download failed (HTTP ${fileRes.status})`);
        }
        const buffer = Buffer.from(await fileRes.arrayBuffer());
        if (buffer.length > this.config.maxUploadBytes) {
            throw new Error(`File exceeds the maximum allowed size of ${Math.round(this.config.maxUploadBytes / (1024 * 1024))} MB`);
        }
        return {
            buffer,
            mime: meta.mime_type ?? 'application/pdf',
            filename: meta.mime_type?.includes('pdf') ? 'whatsapp-document.pdf' : 'whatsapp-media'
        };
    }
    async markRead(messageId) {
        await this.postJson('/messages', {
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: messageId
        });
    }
}
//# sourceMappingURL=cloud-provider.js.map