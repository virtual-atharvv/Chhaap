/**
 * Meta WhatsApp template registry. The exact bodies must be submitted in Meta
 * Business Manager; see docs/whatsapp-templates.md for the copy-paste text and
 * sample values. Keep names configurable in code so they can be changed to the
 * founder's approved names without a schema migration.
 */
export const WHATSAPP_TEMPLATES = {
    order_paid_receipt: {
        name: 'order_paid_receipt',
        category: 'utility',
        language: 'en',
        body: 'Payment received for your print order at {{1}}. Pickup token: {{2}}. Amount paid: {{3}}. We will message you when it is ready.',
        variables: ['shopName', 'token', 'amount']
    },
    order_ready_pickup: {
        name: 'order_ready_pickup',
        category: 'utility',
        language: 'en',
        body: 'Your prints are ready at {{1}}. Collect them using token {{2}}.',
        variables: ['shopName', 'token']
    },
    order_failed_refund: {
        name: 'order_failed_refund',
        category: 'utility',
        language: 'en',
        body: 'We could not print order {{2}} at {{1}}. A refund of {{3}} has been initiated and should reach you in 3-5 working days.',
        variables: ['shopName', 'token', 'amount']
    },
    shop_printer_alert: {
        name: 'shop_printer_alert',
        category: 'utility',
        language: 'en',
        body: 'Alert for {{1}}: printer "{{2}}" is {{3}}. New orders may be paused until it is back online.',
        variables: ['shopName', 'printerName', 'status']
    },
    shop_daily_summary: {
        name: 'shop_daily_summary',
        category: 'utility',
        language: 'en',
        body: 'Daily summary for {{1}}: {{2}} orders, {{3}} pages printed, revenue {{4}}. Reply QUEUE to see pending orders.',
        variables: ['shopName', 'orderCount', 'pageCount', 'revenue']
    },
    shop_login_otp: {
        name: 'shop_login_otp',
        category: 'authentication',
        language: 'en',
        body: '{{1}} is your Chhaap shop login code. It expires in 5 minutes. Do not share it with anyone.',
        variables: ['otp']
    }
};
export function getTemplate(name) {
    return WHATSAPP_TEMPLATES[name];
}
//# sourceMappingURL=templates.js.map