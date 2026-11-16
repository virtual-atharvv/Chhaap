import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateOrderPricing,
  calculatePricing,
  classifyPageCoverage,
  parsePageRange,
  DEFAULT_SHOP_CONFIG
} from '../dist/index.js';
import type { PrintSettings } from '@chhaap/shared';

function settings(overrides: Partial<PrintSettings> = {}): PrintSettings {
  return {
    copies: 1,
    paperSize: 'A4',
    colorMode: 'bw',
    sides: 'single',
    pagesPerSheet: 1,
    orientation: 'auto',
    fitMode: 'fit',
    ...overrides
  };
}

describe('Pricing engine', () => {
  it('parses page ranges accurately', () => {
    assert.deepEqual(parsePageRange('1-3, 5, 8-10', 10), [1, 2, 3, 5, 8, 9, 10]);
    assert.deepEqual(parsePageRange('', 5), [1, 2, 3, 4, 5]);
    assert.deepEqual(parsePageRange(undefined, 4), [1, 2, 3, 4]);
    assert.deepEqual(parsePageRange('15-20', 10), []);
    assert.deepEqual(parsePageRange('3, 3, 2', 5), [2, 3]);
  });

  it('prices single-sided B&W at integer paise', () => {
    const result = calculatePricing({ totalPages: 10, settings: settings() });
    assert.equal(result.bwPagesCount, 10);
    assert.equal(result.colorPagesCount, 0);
    assert.equal(result.sheets, 10);
    assert.equal(result.bwSubtotalPaise, 2000);
    assert.equal(result.subtotalPaise, 2000);
    assert.equal(result.feePaise, 100);
    assert.equal(result.totalPaise, 2100);
    assert.equal(Number.isInteger(result.totalPaise), true);
  });

  it('prices duplex per page, not per sheet', () => {
    const result = calculatePricing({
      totalPages: 9,
      settings: settings({ sides: 'duplex' })
    });
    assert.equal(result.sheets, 5);
    assert.equal(result.bwSubtotalPaise, 1350);
    assert.equal(result.totalPaise, 1450);
  });

  it('prices Smart mode using colour-page classification', () => {
    const result = calculatePricing({
      totalPages: 50,
      perPageClassification: classifyPageCoverage([
        { c: 0, m: 0, y: 0 },
        { c: 0, m: 0, y: 0 },
        { c: 0.3, m: 0, y: 0 }
      ]),
      settings: settings({ colorMode: 'smart' })
    });
    // Only page 3 is classified colour; pages without classification are B&W.
    assert.equal(result.colorPagesCount, 1);
    assert.equal(result.bwPagesCount, 49);
    assert.equal(result.subtotalPaise, 49 * 200 + 1 * 1000);
    assert.equal(result.totalPaise, 10900);
  });

  it('enforces the whole-order minimum before the fee is displayed', () => {
    const result = calculatePricing({ totalPages: 1, settings: settings() });
    assert.equal(result.subtotalPaise, 200);
    assert.equal(result.feePaise, 100);
    assert.equal(result.totalPaise, 500);
    assert.ok(result.totalPaise >= DEFAULT_SHOP_CONFIG.minOrderPaise);
  });

  it('applies GST once on the order and keeps totals integer', () => {
    const shop = { ...DEFAULT_SHOP_CONFIG, gstRatePercent: 18 };
    const single = calculatePricing({ totalPages: 10, settings: settings() }, shop);
    assert.equal(single.gstPaise, 378); // 18% of (2000 + 100)
    assert.equal(single.totalPaise, 2478);

    const order = calculateOrderPricing(
      [
        { totalPages: 10, settings: settings() },
        { totalPages: 4, settings: settings({ copies: 2 }) }
      ],
      shop
    );
    // 2000 + 1600 = 3600; fee 100; GST 18% of 3700 => 666; total 4366.
    assert.equal(order.subtotalPaise, 3600);
    assert.equal(order.feePaise, 100);
    assert.equal(order.gstPaise, 666);
    assert.equal(order.totalPaise, 4366);
  });

  it('sums multi-file order lines without duplicating the fee', () => {
    const order = calculateOrderPricing([
      { totalPages: 10, settings: settings() },
      { totalPages: 5, settings: settings({ copies: 2, colorMode: 'color' }) }
    ]);
    assert.equal(order.items.length, 2);
    assert.equal(order.subtotalPaise, 2000 + 10000);
    assert.equal(order.feePaise, 100);
    assert.equal(order.totalPaise, 12100);
    assert.equal(
      order.subtotalPaise,
      order.items.reduce((sum, item) => sum + item.subtotalPaise, 0)
    );
  });

  it('is monotonic in pages and copies and never negative', () => {
    let previousPages = 0;
    for (let pages = 1; pages <= 24; pages++) {
      let previousCopies = 0;
      for (const copies of [1, 2, 5]) {
        const result = calculatePricing({ totalPages: pages, settings: settings({ copies }) });
        assert.equal(Number.isInteger(result.totalPaise), true);
        assert.ok(result.totalPaise >= DEFAULT_SHOP_CONFIG.minOrderPaise);
        assert.ok(result.totalPaise >= 0);
        assert.ok(result.totalPaise >= previousCopies);
        previousCopies = result.totalPaise;
      }
      assert.ok(previousCopies >= previousPages);
      previousPages = previousCopies;
    }
  });

  it('classifies colour pages from ink coverage', () => {
    const pages = classifyPageCoverage([
      { c: 0, m: 0, y: 0 },
      { c: 0, m: 0.001, y: 0 },
      { c: 0, m: 0, y: 0.0001 }
    ]);
    assert.deepEqual(
      pages.map((p) => p.isColor),
      [false, true, false]
    );
  });
});
