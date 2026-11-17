import { loadConfig } from '../config.js';
import { mockWhatsAppProvider } from './mock-provider.js';
import { CloudApiWhatsAppProvider } from './cloud-provider.js';
export * from './provider.js';
export * from './mock-provider.js';
export * from './cloud-provider.js';
let cloudProviderInstance = null;
export function getWhatsAppProvider() {
    const config = loadConfig();
    if (config.whatsappMode === 'cloud') {
        if (!cloudProviderInstance) {
            cloudProviderInstance = new CloudApiWhatsAppProvider();
        }
        return cloudProviderInstance;
    }
    return mockWhatsAppProvider;
}
//# sourceMappingURL=index.js.map