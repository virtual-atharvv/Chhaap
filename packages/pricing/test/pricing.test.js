import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePricing,
  parsePageRange,
  DEFAULT_SHOP_CONFIG
} from '../dist/index.js';

describe('Pricing Engine', () => {
  it('parses page ranges accurately', () => {
    assert.deepEqual(parsePageRange('1-3, 5, 8-10', 10), [1, 2, 3, 5, 8, 9, 10]);
    assert.deepEqual(parsePageRange('', 5), [1, 2, 3, 4, 5]);
    assert.deepEqual(parsePageRange(undefined, 4), [1, 2, 3, 4]);
    assert.deepEqual(parsePageRange('15-20', 10), []);
  });

  it('calculates single-sided B&W price accurately', () => {
    // 10 pages, A4, single, bw, 1 copy:
    // 10 * 200 = 2000 paise (₹20) + 100 convenience = 2100 paise (₹21)
    const result = calculatePricing({
      totalPages: 10,
      settings: {
        copies: 1,
        paperSize: 'A4',
        colorMode: 'bw',
        sides: 'single',
        pagesPerSheet: 1,
        orientation: 'auto',
        fitMode: 'fit'
      }
    });

    assert.equal(result.bwPagesCount, 10);
    assert.equal(result.colorPagesCount, 0);
    assert.equal(result.sheets, 10);
    assert.equal(result.bwSubtotalPaise, 2000);
    assert.equal(result.subtotalPaise, 2000);
    assert.equal(result.feePaise, 100);
    assert.equal(result.totalPaise, 2100);
  });

  it('calculates duplex B&W sheets and discount accurately', () => {
    // 9 pages, A4, duplex:
    // sheets = ceil(9 / 2) = 5 sheets
    // price = 9 pages * 150 = 1350 paise + 100 fee = 1450 paise
    const result = calculatePricing({
      totalPages: 9,
      settings: {
        copies: 1,
        paperSize: 'A4',
        colorMode: 'bw',
        sides: 'duplex',
        pagesPerSheet: 1,
        orientation: 'auto',
        fitMode: 'fit'
      }
    });

    assert.equal(result.sheets, 5);
    assert.equal(result.bwSubtotalPaise, 1350);
    assert.equal(result.totalPaise, 1450);
  });

  it('calculates Smart Color Detection correctly (implementation.md §6.1)', () => {
    // 50 pages total, page 3, 14, 25 are color.
    // In 'smart' mode: 47 B&W pages * ₹2 (200) + 3 Colour pages * ₹10 (1000)
    // = 9400 + 3000 = 12400 paise (₹124) + 100 fee = 12500 paise
    const classifications = [
      { pageNumber: 3, isColor: true },
      { pageNumber: 14, isColor: true },
      { pageNumber: 25, isColor: true }
    ];

    const result = calculatePricing({
      totalPages: 50,
      perPageClassification: classifications,
      settings: {
        copies: 1,
        paperSize: 'A4',
        colorMode: 'smart',
        sides: 'single',
        pagesPerSheet: 1,
        orientation: 'auto',
        fitMode: 'fit'
      }
    });

    assert.equal(result.bwPagesCount, 47);
    assert.equal(result.colorPagesCount, 3);
    assert.equal(result.bwSubtotalPaise, 9400);
    assert.equal(result.colorSubtotalPaise, 3000);
    assert.equal(result.subtotalPaise, 12400);
    assert.equal(result.totalPaise, 12500);
  });

  it('enforces min order amount invariant', () => {
    // 1 page B&W single = 200 + 100 fee = 300 paise.
    // minOrderPaise is 500 paise (₹5).
    const result = calculatePricing({
      totalPages: 1,
      settings: {
        copies: 1,
        paperSize: 'A4',
        colorMode: 'bw',
        sides: 'single',
        pagesPerSheet: 1,
        orientation: 'auto',
        fitMode: 'fit'
      }
    });

    assert.equal(result.totalPaise, 500);
  });

  it('multiplies cleanly with copies and n-up imposition', () => {
    // 8 pages, 2-up, duplex, 3 copies:
    // pagesPerPhysicalSheet = 2 * 2 = 4 pages per sheet
    // sheetsPerCopy = ceil(8 / 4) = 2 sheets
    // total sheets = 2 * 3 = 6 sheets
    const result = calculatePricing({
      totalPages: 8,
      settings: {
        copies: 3,
        paperSize: 'A4',
        colorMode: 'bw',
        sides: 'duplex',
        pagesPerSheet: 2,
        orientation: 'auto',
        fitMode: 'fit'
      }
    });

    assert.equal(result.sheets, 6);
  });

  it('property-based test: price is always an integer >= minOrder and monotonic with copies', () => {
    for (let pages = 1; pages <= 20; pages += 3) {
      for (let copies = 1; copies <= 5; copies++) {
        const res1 = calculatePricing({
          totalPages: pages,
          settings: {
            copies,
            paperSize: 'A4',
            colorMode: 'bw',
            sides: 'single',
            pagesPerSheet: 1,
            orientation: 'auto',
            fitMode: 'fit'
          }
        });

        const res2 = calculatePricing({
          totalPages: pages,
          settings: {
            copies: copies + 1,
            paperSize: 'A4',
            colorMode: 'bw',
            sides: 'single',
            pagesPerSheet: 1,
            orientation: 'auto',
            fitMode: 'fit'
          }
        });

        assert.equal(Number.isInteger(res1.totalPaise), true);
        assert.ok(res1.totalPaise >= DEFAULT_SHOP_CONFIG.minOrderPaise);
        assert.ok(res2.totalPaise >= res1.totalPaise);
      }
    }
  });
});
