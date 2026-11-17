export const DEFAULT_STANDARD_INDIAN_RATES = [
    // A4
    { paperSize: 'A4', colorMode: 'bw', sides: 'single', pricePerPagePaise: 200 }, // ₹2
    { paperSize: 'A4', colorMode: 'bw', sides: 'duplex', pricePerPagePaise: 150 }, // ₹1.5 (₹3/sheet)
    { paperSize: 'A4', colorMode: 'color', sides: 'single', pricePerPagePaise: 1000 }, // ₹10
    { paperSize: 'A4', colorMode: 'color', sides: 'duplex', pricePerPagePaise: 800 }, // ₹8 (₹16/sheet)
    // A3
    { paperSize: 'A3', colorMode: 'bw', sides: 'single', pricePerPagePaise: 1000 }, // ₹10
    { paperSize: 'A3', colorMode: 'bw', sides: 'duplex', pricePerPagePaise: 800 }, // ₹8
    { paperSize: 'A3', colorMode: 'color', sides: 'single', pricePerPagePaise: 3000 }, // ₹30
    { paperSize: 'A3', colorMode: 'color', sides: 'duplex', pricePerPagePaise: 2500 }, // ₹25
    // Legal
    { paperSize: 'Legal', colorMode: 'bw', sides: 'single', pricePerPagePaise: 300 }, // ₹3
    { paperSize: 'Legal', colorMode: 'bw', sides: 'duplex', pricePerPagePaise: 200 }, // ₹2
    { paperSize: 'Legal', colorMode: 'color', sides: 'single', pricePerPagePaise: 1200 }, // ₹12
    { paperSize: 'Legal', colorMode: 'color', sides: 'duplex', pricePerPagePaise: 1000 } // ₹10
];
export const DEFAULT_SHOP_CONFIG = {
    minOrderPaise: 500, // ₹5 min order
    platformConvenienceFeePaise: 100, // ₹1 convenience fee
    gstRatePercent: 0,
    rates: DEFAULT_STANDARD_INDIAN_RATES
};
/**
 * Parses a page range string (e.g., "1-3, 5, 7-10") into a sorted set of
 * page numbers bounded by totalPages.
 */
export function parsePageRange(pageRange, totalPages) {
    if (totalPages <= 0)
        return [];
    if (!pageRange || pageRange.trim() === '') {
        return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pagesSet = new Set();
    const parts = pageRange.split(',');
    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed)
            continue;
        if (trimmed.includes('-')) {
            const [startStr, endStr] = trimmed.split('-');
            const start = parseInt(startStr, 10);
            const end = parseInt(endStr, 10);
            if (!isNaN(start) && !isNaN(end)) {
                const from = Math.max(1, Math.min(start, end));
                const to = Math.min(totalPages, Math.max(start, end));
                for (let p = from; p <= to; p++) {
                    pagesSet.add(p);
                }
            }
        }
        else {
            const page = parseInt(trimmed, 10);
            if (!isNaN(page) && page >= 1 && page <= totalPages) {
                pagesSet.add(page);
            }
        }
    }
    return Array.from(pagesSet).sort((a, b) => a - b);
}
/**
 * Finds the rate per page from a shop rate card. Falls back to standard
 * Indian defaults when the shop has not configured a particular combination.
 */
export function lookupRate(rates, paperSize, colorMode, sides) {
    const match = rates.find((r) => r.paperSize === paperSize && r.colorMode === colorMode && r.sides === sides);
    if (match)
        return match.pricePerPagePaise;
    const fallback = DEFAULT_STANDARD_INDIAN_RATES.find((r) => r.paperSize === paperSize && r.colorMode === colorMode && r.sides === sides);
    if (fallback)
        return fallback.pricePerPagePaise;
    if (colorMode === 'color') {
        return sides === 'duplex' ? 800 : 1000;
    }
    return sides === 'duplex' ? 150 : 200;
}
/**
 * Pure pricing engine for one document. All money is integer paise.
 */
export function calculatePricing(input, shopConfig = DEFAULT_SHOP_CONFIG) {
    const { totalPages, settings, perPageClassification, addonsPaise = 0 } = input;
    const copies = Math.max(1, Math.floor(settings.copies || 1));
    const selectedPages = parsePageRange(settings.pageRange, totalPages);
    const selectedCount = selectedPages.length;
    const colorMap = new Map();
    if (perPageClassification) {
        for (const c of perPageClassification) {
            colorMap.set(c.pageNumber, c.isColor);
        }
    }
    let bwPagesCount = 0;
    let colorPagesCount = 0;
    for (const pageNum of selectedPages) {
        if (settings.colorMode === 'bw') {
            bwPagesCount++;
        }
        else if (settings.colorMode === 'color') {
            colorPagesCount++;
        }
        else {
            const isDetectedColor = colorMap.get(pageNum) ?? false;
            if (isDetectedColor) {
                colorPagesCount++;
            }
            else {
                bwPagesCount++;
            }
        }
    }
    // sheets = ceil(selectedCount / (pagesPerSheet * (duplex ? 2 : 1))) * copies
    const duplexMultiplier = settings.sides === 'duplex' ? 2 : 1;
    const pagesPerSheet = settings.pagesPerSheet || 1;
    const pagesPerPhysicalSheet = pagesPerSheet * duplexMultiplier;
    const sheets = pagesPerPhysicalSheet > 0 ? Math.ceil(selectedCount / pagesPerPhysicalSheet) * copies : 0;
    const ratePerPageBwPaise = lookupRate(shopConfig.rates, settings.paperSize, 'bw', settings.sides);
    const ratePerPageColorPaise = lookupRate(shopConfig.rates, settings.paperSize, 'color', settings.sides);
    const bwSubtotalPaise = bwPagesCount * ratePerPageBwPaise * copies;
    const colorSubtotalPaise = colorPagesCount * ratePerPageColorPaise * copies;
    const pageCostPaise = bwSubtotalPaise + colorSubtotalPaise;
    const subtotalPaise = pageCostPaise + addonsPaise;
    const feePaise = shopConfig.platformConvenienceFeePaise;
    const gstPaise = Math.round((subtotalPaise + feePaise) * (shopConfig.gstRatePercent / 100));
    // Invariant: total is at least minOrderPaise.
    const totalPaise = Math.max(subtotalPaise + feePaise + gstPaise, shopConfig.minOrderPaise);
    return {
        selectedPages,
        selectedCount,
        bwPagesCount,
        colorPagesCount,
        sheets,
        copies,
        ratePerPageBwPaise,
        ratePerPageColorPaise,
        bwSubtotalPaise,
        colorSubtotalPaise,
        addonsPaise,
        subtotalPaise,
        feePaise,
        gstPaise,
        minOrderPaise: shopConfig.minOrderPaise,
        totalPaise
    };
}
/**
 * Pricing for a multi-file order. The platform fee and GST are applied once
 * per order, and the shop minimum applies to the whole order. This is the
 * only function the API uses to price orders, so the quote, the order record,
 * the Razorpay amount and the WhatsApp receipt cannot diverge.
 */
export function calculateOrderPricing(items, shopConfig = DEFAULT_SHOP_CONFIG) {
    const breakdowns = items.map((item) => calculatePricing(item, shopConfig));
    const selectedCount = breakdowns.reduce((sum, b) => sum + b.selectedCount, 0);
    const bwPagesCount = breakdowns.reduce((sum, b) => sum + b.bwPagesCount, 0);
    const colorPagesCount = breakdowns.reduce((sum, b) => sum + b.colorPagesCount, 0);
    const sheets = breakdowns.reduce((sum, b) => sum + b.sheets, 0);
    const subtotalPaise = breakdowns.reduce((sum, b) => sum + b.subtotalPaise, 0);
    const feePaise = shopConfig.platformConvenienceFeePaise;
    const gstPaise = Math.round((subtotalPaise + feePaise) * (shopConfig.gstRatePercent / 100));
    const minOrderPaise = shopConfig.minOrderPaise;
    const totalPaise = Math.max(subtotalPaise + feePaise + gstPaise, minOrderPaise);
    return {
        items: breakdowns,
        selectedCount,
        bwPagesCount,
        colorPagesCount,
        sheets,
        subtotalPaise,
        feePaise,
        gstPaise,
        minOrderPaise,
        totalPaise
    };
}
/**
 * Classifies each page as colour if any ink coverage is present.
 * Exposed for tests and for the document pipeline.
 */
export function classifyPageCoverage(coverage, threshold = 0.0005) {
    return coverage.map((page, index) => ({
        pageNumber: index + 1,
        isColor: page.c > threshold || page.m > threshold || page.y > threshold
    }));
}
//# sourceMappingURL=index.js.map