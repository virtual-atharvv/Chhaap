/**
 * Meta WhatsApp template registry. The exact bodies must be submitted in Meta
 * Business Manager; see docs/whatsapp-templates.md for the copy-paste text and
 * sample values. Keep names configurable in code so they can be changed to the
 * founder's approved names without a schema migration.
 */
export interface TemplateDefinition {
    name: string;
    category: 'utility' | 'authentication' | 'marketing';
    language: 'en' | 'hi';
    body: string;
    variables: string[];
}
export declare const WHATSAPP_TEMPLATES: Record<string, TemplateDefinition>;
export declare function getTemplate(name: string): TemplateDefinition | undefined;
//# sourceMappingURL=templates.d.ts.map