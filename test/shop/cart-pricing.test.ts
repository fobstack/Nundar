import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { priceCart } from '../../src/plugins/shop/lib/cart-pricing.js';
import type { Currency } from '../../src/plugins/shop/lib/currency.js';
import {
  clearShopTables,
  createProduct,
  createVariant,
  db,
  ensureSite,
  setPrice,
  type TestProduct,
} from './helpers.js';

let valve: TestProduct;
let draft: TestProduct;

function price(
  lines: { variantId: string; quantity: number }[],
  currency: Currency = 'USD',
  locale = 'en',
) {
  return priceCart(db(), {
    lines,
    locale,
    defaultLocale: 'en',
    currency,
  });
}

describe('priceCart', () => {
  beforeAll(async () => {
    await ensureSite();
    valve = await createProduct({
      title: 'Stainless ball valve',
      slug: 'pricing-ball-valve',
    });
    await createProduct({
      title: 'Edelstahl-Kugelhahn',
      slug: 'pricing-kugelhahn',
      locale: 'de',
      translationGroup: valve.translationGroup,
    });
    draft = await createProduct({
      title: 'Unreleased valve',
      slug: 'pricing-unreleased',
      status: 'draft',
    });
  });

  beforeEach(async () => {
    await clearShopTables();
    await createVariant({
      id: 'dn50',
      productGroup: valve.translationGroup,
      sku: 'BV-DN50',
      moq: 10,
      stock: 100,
    });
    await setPrice({
      variantId: 'dn50',
      currency: 'USD',
      amountMinor: 9900,
      source: 'base',
    });
    await setPrice({
      variantId: 'dn50',
      currency: 'EUR',
      amountMinor: 9399,
      source: 'auto',
      rateUsed: 0.92,
    });
  });

  it('prices a valid cart from current database values', async () => {
    const result = await price([{ variantId: 'dn50', quantity: 10 }]);

    expect(result).toEqual({
      ok: true,
      currency: 'USD',
      subtotalMinor: 99000,
      lines: [
        {
          variantId: 'dn50',
          sku: 'BV-DN50',
          name: 'Stainless ball valve',
          quantity: 10,
          unitPriceMinor: 9900,
          lineTotalMinor: 99000,
        },
      ],
    });
  });

  it('uses the product name in the requested language', async () => {
    const result = await price(
      [{ variantId: 'dn50', quantity: 10 }],
      'EUR',
      'de',
    );

    expect(result.ok && result.lines[0]?.name).toBe('Edelstahl-Kugelhahn');
    expect(result.ok && result.currency).toBe('EUR');
    expect(result.ok && result.lines[0]?.unitPriceMinor).toBe(9399);
  });

  it('falls back to the default language for a name with no translation', async () => {
    const result = await price(
      [{ variantId: 'dn50', quantity: 10 }],
      'USD',
      'fr',
    );

    expect(result.ok && result.lines[0]?.name).toBe('Stainless ball valve');
  });

  it('sums multiple lines', async () => {
    await createVariant({
      id: 'dn80',
      productGroup: valve.translationGroup,
      sku: 'BV-DN80',
    });
    await setPrice({
      variantId: 'dn80',
      currency: 'USD',
      amountMinor: 15000,
      source: 'base',
    });

    const result = await price([
      { variantId: 'dn50', quantity: 10 },
      { variantId: 'dn80', quantity: 2 },
    ]);

    expect(result.ok && result.subtotalMinor).toBe(99000 + 30000);
  });

  it('rejects a quantity below the minimum order quantity', async () => {
    const result = await price([{ variantId: 'dn50', quantity: 9 }]);

    expect(result).toEqual({
      ok: false,
      issues: [{ kind: 'below_moq', variantId: 'dn50', moq: 10, requested: 9 }],
    });
  });

  it('rejects a quantity above the stock of a tracked variant', async () => {
    const result = await price([{ variantId: 'dn50', quantity: 101 }]);

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          kind: 'insufficient_stock',
          variantId: 'dn50',
          available: 100,
          requested: 101,
        },
      ],
    });
  });

  it('does not limit a made-to-order variant by stock', async () => {
    await createVariant({
      id: 'custom',
      productGroup: valve.translationGroup,
      stock: 0,
      stockPolicy: 'made_to_order',
    });
    await setPrice({
      variantId: 'custom',
      currency: 'USD',
      amountMinor: 50000,
      source: 'base',
    });

    const result = await price([{ variantId: 'custom', quantity: 500 }]);

    expect(result.ok && result.subtotalMinor).toBe(25_000_000);
  });

  it('rejects a variant that does not exist', async () => {
    const result = await price([{ variantId: 'ghost', quantity: 1 }]);

    expect(result).toEqual({
      ok: false,
      issues: [{ kind: 'unavailable', variantId: 'ghost' }],
    });
  });

  it('rejects an archived variant', async () => {
    await createVariant({
      id: 'old',
      productGroup: valve.translationGroup,
      status: 'archived',
    });
    await setPrice({
      variantId: 'old',
      currency: 'USD',
      amountMinor: 100,
      source: 'base',
    });

    const result = await price([{ variantId: 'old', quantity: 1 }]);

    expect(result).toEqual({
      ok: false,
      issues: [{ kind: 'unavailable', variantId: 'old' }],
    });
  });

  it('rejects a variant whose product is not published', async () => {
    await createVariant({ id: 'secret', productGroup: draft.translationGroup });
    await setPrice({
      variantId: 'secret',
      currency: 'USD',
      amountMinor: 100,
      source: 'base',
    });

    const result = await price([{ variantId: 'secret', quantity: 1 }]);

    expect(result).toEqual({
      ok: false,
      issues: [{ kind: 'unavailable', variantId: 'secret' }],
    });
  });

  it('rejects a variant with no price rather than charging zero', async () => {
    await createVariant({
      id: 'unpriced',
      productGroup: valve.translationGroup,
    });

    const result = await price([{ variantId: 'unpriced', quantity: 1 }]);

    expect(result).toEqual({
      ok: false,
      issues: [{ kind: 'no_price', variantId: 'unpriced' }],
    });
  });

  it('reports every problem at once instead of one at a time', async () => {
    const result = await price([
      { variantId: 'dn50', quantity: 1 },
      { variantId: 'ghost', quantity: 1 },
    ]);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.map((issue) => issue.kind)).toEqual([
      'below_moq',
      'unavailable',
    ]);
  });

  it('falls the whole order back to the base currency when a line lacks the requested one', async () => {
    await createVariant({
      id: 'usd-only',
      productGroup: valve.translationGroup,
    });
    await setPrice({
      variantId: 'usd-only',
      currency: 'USD',
      amountMinor: 500,
      source: 'base',
    });

    const result = await price(
      [
        { variantId: 'dn50', quantity: 10 },
        { variantId: 'usd-only', quantity: 1 },
      ],
      'EUR',
    );

    // Never a euro price beside a dollar price in one total, and never a
    // dollar amount charged as euros.
    expect(result.ok && result.currency).toBe('USD');
    expect(result.ok && result.subtotalMinor).toBe(99000 + 500);
  });

  it('rejects an empty cart', async () => {
    expect(await price([])).toEqual({
      ok: false,
      issues: [{ kind: 'empty' }],
    });
  });
});
