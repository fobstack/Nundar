import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PRICING_RULES } from '../../src/plugins/shop/lib/pricing.js';
import {
  readRates,
  repriceChunk,
  storeRatesStatements,
} from '../../src/plugins/shop/lib/rates.js';
import {
  clearShopTables,
  db,
  ensureSite,
  priceOf,
  setPrice,
  setRate,
} from './helpers.js';

const NOW = new Date('2026-10-01T06:00:00.000Z');

function reprice(cursor = '', limit = 50) {
  return repriceChunk(db(), {
    rules: DEFAULT_PRICING_RULES,
    cursor,
    limit,
    now: NOW,
  });
}

describe('storing rates', () => {
  beforeAll(ensureSite);
  beforeEach(clearShopTables);

  it('stores one row per quote currency', async () => {
    await db().batch(
      storeRatesStatements(db(), {
        rates: { EUR: 0.92, GBP: 0.79 },
        referenceDate: '2026-09-30',
        source: 'ecb',
        now: NOW,
      }),
    );

    const rates = await readRates(db());
    expect(rates.referenceDate).toBe('2026-09-30');
    expect(rates.byCurrency.get('EUR')).toBe(0.92);
    expect(rates.byCurrency.get('GBP')).toBe(0.79);
  });

  it('overwrites the previous snapshot rather than accumulating rows', async () => {
    for (const [rate, date] of [
      [0.92, '2026-09-29'],
      [0.95, '2026-09-30'],
    ] as const) {
      await db().batch(
        storeRatesStatements(db(), {
          rates: { EUR: rate },
          referenceDate: date,
          source: 'ecb',
          now: NOW,
        }),
      );
    }

    const count = await db()
      .prepare('SELECT COUNT(*) AS n FROM p_shop_rate')
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
    expect((await readRates(db())).byCurrency.get('EUR')).toBe(0.95);
  });

  it('ignores the base currency and currencies the shop does not price in', () => {
    const statements = storeRatesStatements(db(), {
      rates: { USD: 1, JPY: 150, EUR: 0.92, GBP: 0 },
      referenceDate: '2026-09-30',
      source: 'ecb',
      now: NOW,
    });
    // Only EUR survives: USD is the base, JPY is unsupported, and a zero rate
    // would price everything at nothing.
    expect(statements).toHaveLength(1);
  });
});

describe('repricing', () => {
  beforeAll(ensureSite);
  beforeEach(clearShopTables);

  it('creates auto prices for currencies that had none', async () => {
    await setPrice({
      variantId: 'v1',
      currency: 'USD',
      amountMinor: 9900,
      source: 'base',
    });
    await setRate('EUR', 0.92);
    await setRate('GBP', 0.79);

    const result = await reprice();

    expect(result.updated).toBe(2);
    expect(result.changedVariantIds).toEqual(['v1']);
    // 9900 * 0.92 = 9108; * 1.03 = 9381 -> 9399
    expect(await priceOf('v1', 'EUR')).toMatchObject({
      amount_minor: 9399,
      source: 'auto',
      rate_used: 0.92,
    });
    // 9900 * 0.79 = 7821; * 1.03 = 8056 -> 8099
    expect(await priceOf('v1', 'GBP')).toMatchObject({
      amount_minor: 8099,
      source: 'auto',
    });
  });

  it('leaves the base-currency price untouched', async () => {
    await setPrice({
      variantId: 'v1',
      currency: 'USD',
      amountMinor: 9900,
      source: 'base',
    });
    await setRate('EUR', 0.92);

    await reprice();

    expect(await priceOf('v1', 'USD')).toMatchObject({
      amount_minor: 9900,
      source: 'base',
    });
  });

  it('never overwrites a manually set price', async () => {
    await setPrice({
      variantId: 'v1',
      currency: 'USD',
      amountMinor: 9900,
      source: 'base',
    });
    await setPrice({
      variantId: 'v1',
      currency: 'EUR',
      amountMinor: 8500,
      source: 'manual',
    });
    await setRate('EUR', 0.92);

    const result = await reprice();

    expect(result.manual).toBe(1);
    expect(result.updated).toBe(0);
    expect(await priceOf('v1', 'EUR')).toMatchObject({
      amount_minor: 8500,
      source: 'manual',
    });
  });

  it('holds the price steady while the rate drifts under the threshold', async () => {
    await setPrice({
      variantId: 'v1',
      currency: 'USD',
      amountMinor: 9900,
      source: 'base',
    });
    await setPrice({
      variantId: 'v1',
      currency: 'EUR',
      amountMinor: 9399,
      source: 'auto',
      rateUsed: 0.92,
    });
    // 0.92 -> 0.93 is 1.09% of drift, under the 2% threshold.
    await setRate('EUR', 0.93);

    const result = await reprice();

    expect(result.skipped).toBe(1);
    expect(result.changedVariantIds).toEqual([]);
    expect(await priceOf('v1', 'EUR')).toMatchObject({
      amount_minor: 9399,
      rate_used: 0.92,
    });
  });

  it('reprices once the rate drifts beyond the threshold', async () => {
    await setPrice({
      variantId: 'v1',
      currency: 'USD',
      amountMinor: 9900,
      source: 'base',
    });
    await setPrice({
      variantId: 'v1',
      currency: 'EUR',
      amountMinor: 9399,
      source: 'auto',
      rateUsed: 0.92,
    });
    // 0.92 -> 0.95 is 3.26% of drift.
    await setRate('EUR', 0.95);

    const result = await reprice();

    expect(result.updated).toBe(1);
    // 9900 * 0.95 = 9405; * 1.03 = 9687 -> 9699
    expect(await priceOf('v1', 'EUR')).toMatchObject({
      amount_minor: 9699,
      rate_used: 0.95,
    });
  });

  it('does nothing when no rates have been fetched yet', async () => {
    await setPrice({
      variantId: 'v1',
      currency: 'USD',
      amountMinor: 9900,
      source: 'base',
    });

    const result = await reprice();

    expect(result).toMatchObject({ updated: 0, skipped: 0, manual: 0 });
    expect(await priceOf('v1', 'EUR')).toBeNull();
  });

  it('works through a catalogue in chunks, resuming from a cursor', async () => {
    for (const variantId of ['v1', 'v2', 'v3']) {
      await setPrice({
        variantId,
        currency: 'USD',
        amountMinor: 1000,
        source: 'base',
      });
    }
    await setRate('EUR', 0.92);

    const first = await reprice('', 2);
    expect(first.changedVariantIds).toEqual(['v1', 'v2']);
    expect(first.nextCursor).toBe('v2');
    expect(await priceOf('v3', 'EUR')).toBeNull();

    const second = await reprice(first.nextCursor ?? '', 2);
    expect(second.changedVariantIds).toEqual(['v3']);
    expect(second.nextCursor).toBeNull();
    expect(await priceOf('v3', 'EUR')).not.toBeNull();
  });

  it('costs two round trips whatever the chunk size', async () => {
    // Reading and writing each price separately would pass D1's
    // per-invocation query limit on a catalogue of any size.
    for (let index = 0; index < 40; index += 1) {
      await setPrice({
        variantId: `v${String(index).padStart(2, '0')}`,
        currency: 'USD',
        amountMinor: 1000 + index,
        source: 'base',
      });
    }
    await setRate('EUR', 0.92);
    await setRate('GBP', 0.79);

    // Count every call that reaches D1, on the prototypes the real objects
    // share: a statement's own execution, and the database's batch.
    const statementPrototype = Object.getPrototypeOf(
      db().prepare('SELECT 1'),
    ) as D1PreparedStatement;
    const databasePrototype = Object.getPrototypeOf(db()) as D1Database;
    const spies = [
      vi.spyOn(databasePrototype, 'batch'),
      vi.spyOn(statementPrototype, 'run'),
      vi.spyOn(statementPrototype, 'all'),
      vi.spyOn(statementPrototype, 'first'),
    ];

    let result: Awaited<ReturnType<typeof repriceChunk>>;
    let calls = 0;
    try {
      result = await reprice('', 50);
      calls = spies.reduce((total, spy) => total + spy.mock.calls.length, 0);
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }

    expect(result.updated).toBe(80);
    expect(calls).toBe(2);
  });
});
