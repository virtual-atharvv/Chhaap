import type {
  ColorMode,
  PaperSize,
  PrintSettings,
  RateCardEntry,
  ShopPricingConfig,
  Sides
} from '@chhaap/shared';

export interface PageClassification {
  pageNumber: number; // 1-indexed
  isColor: boolean;
}

export interface PricingInput {
  totalPages: number;
  perPageClassification?: PageClassification[]; // From Ghostscript inkcov
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
  totalPaise: number;
}

export const DEFAULT_STANDARD_INDIAN_RATES: RateCardEntry[] = [
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

export const DEFAULT_SHOP_CONFIG: ShopPricingConfig = {
  minOrderPaise: 500, // ₹5 min order
  platformConvenienceFeePaise: 100, // ₹1 convenience fee
  gstRatePercent: 0,
  rates: DEFAULT_STANDARD_INDIAN_RATES
};

/**
 * Parses page range string (e.g., "1-3, 5, 7-10") into a sorted set of page numbers bounded by totalPages
 */
export function parsePageRange(pageRange: string | undefined, totalPages: number): number[] {
  if (totalPages <= 0) return [];
  if (!pageRange || pageRange.trim() === '') {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pagesSet = new Set<number>();
  const parts = pageRange.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

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
    } else {
      const page = parseInt(trimmed, 10);
      if (!isNaN(page) && page >= 1 && page <= totalPages) {
        pagesSet.add(page);
      }
    }
  }

  return Array.from(pagesSet).sort((a, b) => a - b);
}

/**
 * Finds rate per page from rate card
 */
export function lookupRate(
  rates: RateCardEntry[],
  paperSize: PaperSize,
  colorMode: 'bw' | 'color',
  sides: Sides
): number {
  const match = rates.find(
    (r) => r.paperSize === paperSize && r.colorMode === colorMode && r.sides === sides
  );
  if (match) return match.pricePerPagePaise;

  // Fallback defaults
  if (colorMode === 'color') {
    return sides === 'duplex' ? 800 : 1000;
  }
  return sides === 'duplex' ? 150 : 200;
}

/**
 * Pure Pricing Engine calculation
 */
export function calculatePricing(
  input: PricingInput,
  shopConfig: ShopPricingConfig = DEFAULT_SHOP_CONFIG
): PricingBreakdown {
  const { totalPages, settings, perPageClassification, addonsPaise = 0 } = input;
  const copies = Math.max(1, Math.floor(settings.copies || 1));
  const selectedPages = parsePageRange(settings.pageRange, totalPages);
  const selectedCount = selectedPages.length;

  // Build map of page isColor
  const colorMap = new Map<number, boolean>();
  if (perPageClassification) {
    for (const c of perPageClassification) {
      colorMap.set(c.pageNumber, c.isColor);
    }
  }

  // Count BW vs Color pages according to colorMode setting
  let bwPagesCount = 0;
  let colorPagesCount = 0;

  for (const pageNum of selectedPages) {
    if (settings.colorMode === 'bw') {
      bwPagesCount++;
    } else if (settings.colorMode === 'color') {
      colorPagesCount++;
    } else {
      // 'smart' mode: auto-detect per page
      const isDetectedColor = colorMap.get(pageNum) ?? false;
      if (isDetectedColor) {
        colorPagesCount++;
      } else {
        bwPagesCount++;
      }
    }
  }

  // Sheets calculation:
  // sheets = ceil(selectedCount / (pagesPerSheet * (duplex ? 2 : 1))) * copies
  const duplexMultiplier = settings.sides === 'duplex' ? 2 : 1;
  const pagesPerSheet = settings.pagesPerSheet || 1;
  const pagesPerPhysicalSheet = pagesPerSheet * duplexMultiplier;
  const sheets = Math.ceil(selectedCount / pagesPerPhysicalSheet) * copies;

  // Rates lookup
  const ratePerPageBwPaise = lookupRate(
    shopConfig.rates,
    settings.paperSize,
    'bw',
    settings.sides
  );
  const ratePerPageColorPaise = lookupRate(
    shopConfig.rates,
    settings.paperSize,
    'color',
    settings.sides
  );

  const bwSubtotalPaise = bwPagesCount * ratePerPageBwPaise * copies;
  const colorSubtotalPaise = colorPagesCount * ratePerPageColorPaise * copies;
  const pageCostPaise = bwSubtotalPaise + colorSubtotalPaise;

  const subtotalPaise = pageCostPaise + addonsPaise;
  const feePaise = shopConfig.platformConvenienceFeePaise;
  const gstPaise = Math.round((subtotalPaise + feePaise) * (shopConfig.gstRatePercent / 100));

  // Invariant: total is at least minOrderPaise
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
    totalPaise
  };
}
