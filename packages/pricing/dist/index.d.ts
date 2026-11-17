import type { PageClassification, PaperSize, PrintSettings, RateCardEntry, ShopPricingConfig, Sides } from '@chhaap/shared';
export type { PageClassification } from '@chhaap/shared';
export interface PricingInput {
    totalPages: number;
    perPageClassification?: PageClassification[];
    settings: PrintSettings;
    addonsPaise?: number;
}
export interface PricingBreakdown {
    selectedPages: number[];
    selectedCount: number;
    bwPagesCount: number;
    colorPagesCount: number;
    sheets: number;
    copies: number;
    ratePerPageBwPaise: number;
    ratePerPageColorPaise: number;
    bwSubtotalPaise: number;
    colorSubtotalPaise: number;
    addonsPaise: number;
    subtotalPaise: number;
    feePaise: number;
    gstPaise: number;
    minOrderPaise: number;
    totalPaise: number;
}
export interface OrderPricingItem {
    totalPages: number;
    perPageClassification?: PageClassification[];
    settings: PrintSettings;
    addonsPaise?: number;
}
export interface OrderPricingBreakdown {
    items: PricingBreakdown[];
    selectedCount: number;
    bwPagesCount: number;
    colorPagesCount: number;
    sheets: number;
    subtotalPaise: number;
    feePaise: number;
    gstPaise: number;
    minOrderPaise: number;
    totalPaise: number;
}
export declare const DEFAULT_STANDARD_INDIAN_RATES: RateCardEntry[];
export declare const DEFAULT_SHOP_CONFIG: ShopPricingConfig;
/**
 * Parses a page range string (e.g., "1-3, 5, 7-10") into a sorted set of
 * page numbers bounded by totalPages.
 */
export declare function parsePageRange(pageRange: string | undefined, totalPages: number): number[];
/**
 * Finds the rate per page from a shop rate card. Falls back to standard
 * Indian defaults when the shop has not configured a particular combination.
 */
export declare function lookupRate(rates: RateCardEntry[], paperSize: PaperSize, colorMode: 'bw' | 'color', sides: Sides): number;
/**
 * Pure pricing engine for one document. All money is integer paise.
 */
export declare function calculatePricing(input: PricingInput, shopConfig?: ShopPricingConfig): PricingBreakdown;
/**
 * Pricing for a multi-file order. The platform fee and GST are applied once
 * per order, and the shop minimum applies to the whole order. This is the
 * only function the API uses to price orders, so the quote, the order record,
 * the Razorpay amount and the WhatsApp receipt cannot diverge.
 */
export declare function calculateOrderPricing(items: OrderPricingItem[], shopConfig?: ShopPricingConfig): OrderPricingBreakdown;
/**
 * Classifies each page as colour if any ink coverage is present.
 * Exposed for tests and for the document pipeline.
 */
export declare function classifyPageCoverage(coverage: Array<{
    c: number;
    m: number;
    y: number;
}>, threshold?: number): PageClassification[];
//# sourceMappingURL=index.d.ts.map