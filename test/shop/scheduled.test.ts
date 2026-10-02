import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readRates } from '../../src/plugins/shop/lib/rates.js';
import { runScheduledTick } from '../../src/plugins/shop/lib/scheduled.js';
import {
  clearShopTables,
  db,
  ensureSite,
  priceOf,
  setPrice,
} from './helpers.js';

function ecbXml(date: string, usd: number, gbp: number): string {
  return `<Cube><Cube time='${date}'>
    <Cube currency='USD' rate='${usd}'/>
    <Cube currency='GBP' rate='${gbp}'/>
  </Cube></Cube>`;
}

/** A fetch that answers with the given bodies in turn, and counts its calls. */
function feed(...responses: (string | Response | Error)[]) {
  let calls = 0;
  const impl = (async () => {
    const next = responses[calls];
    calls += 1;
    if (next === undefined) {
      throw new Error('Unexpected fetch in this test.');
    }
    if (next instanceof Error) {
      throw next;
    }
    return next instanceof Response ? next : new Response(next);
  }) as typeof fetch;
  return { impl, calls: () => calls };
}

const T0 = new Date('2026-10-01T06:00:00.000Z');

function minutesAfter(minutes: number): () => Date {
  return () => new Date(T0.getTime() + minutes * 60_000);
}

function tick(fetchImpl: typeof fetch, now: () => Date) {
  return runScheduledTick(
    { db: db(), settings: {} },
    { fetch: fetchImpl, now },
  );
}

async function insertCart(id: string, expiresAt: string): Promise<void> {
  await db().batch([
    db()
      .prepare(
        `INSERT INTO p_shop_cart (id, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(id, T0.toISOString(), T0.toISOString(), expiresAt),
    db()
      .prepare(
        'INSERT INTO p_shop_cart_line (cart_id, variant_id, quantity) VALUES (?, ?, 1)',
      )
      .bind(id, 'v1'),
  ]);
}

describe('the scheduled tick', () => {
  beforeAll(ensureSite);
  beforeEach(clearShopTables);

  it('fetches rates, then reprices on the following ticks', async () => {
    await setPrice({
      variantId: 'v1',
      currency: 'USD',
      amountMinor: 9900,
      source: 'base',
    });
    const ecb = feed(ecbXml('2026-09-30', 1.1622, 0.85898));

    const first = await tick(ecb.impl, minutesAfter(0));
    expect(first).toEqual({
      kind: 'rates_refreshed',
      referenceDate: '2026-09-30',
      repricing: true,
    });
    // One piece of work per tick: the rates are stored, no price has moved yet.
    expect(await priceOf('v1', 'EUR')).toBeNull();

    const second = await tick(ecb.impl, minutesAfter(1));
    expect(second).toMatchObject({ kind: 'repriced', updated: 2, done: true });
    // 1 USD = 1/1.1622 EUR = 0.860437; 9900 * that = 8518; * 1.03 = 8774 -> 8799
    expect(await priceOf('v1', 'EUR')).toMatchObject({
      amount_minor: 8799,
      source: 'auto',
    });
    // 1 USD = 0.85898/1.1622 GBP = 0.739098; 9900 * that = 7317; * 1.03 = 7537 -> 7599
    expect(await priceOf('v1', 'GBP')).toMatchObject({ amount_minor: 7599 });

    expect(ecb.calls()).toBe(1);
  });

  it('does not refetch every minute', async () => {
    const ecb = feed(ecbXml('2026-09-30', 1.1622, 0.85898));

    await tick(ecb.impl, minutesAfter(0));
    await tick(ecb.impl, minutesAfter(1)); // the repricing run
    await tick(ecb.impl, minutesAfter(2)); // housekeeping
    const later = await tick(ecb.impl, minutesAfter(3));

    expect(later).toEqual({ kind: 'idle' });
    expect(ecb.calls()).toBe(1);
  });

  it('starts no repricing run for a reference date it already has', async () => {
    // The ECB repeats Friday's figures all weekend.
    const ecb = feed(
      ecbXml('2026-09-30', 1.1622, 0.85898),
      ecbXml('2026-09-30', 1.1622, 0.85898),
    );

    await tick(ecb.impl, minutesAfter(0));
    await tick(ecb.impl, minutesAfter(1));
    const again = await tick(ecb.impl, minutesAfter(6 * 60));

    expect(again).toEqual({
      kind: 'rates_refreshed',
      referenceDate: '2026-09-30',
      repricing: false,
    });
    expect(ecb.calls()).toBe(2);
  });

  it('reports a failed fetch without throwing, and keeps the snapshot', async () => {
    const ecb = feed(
      ecbXml('2026-09-30', 1.1622, 0.85898),
      new Error('network down'),
    );

    await tick(ecb.impl, minutesAfter(0));
    await tick(ecb.impl, minutesAfter(1));
    const failed = await tick(ecb.impl, minutesAfter(6 * 60));

    expect(failed).toEqual({ kind: 'rates_failed', reason: 'network down' });
    // A failure must never distort a price: the earlier snapshot stands.
    const rates = await readRates(db());
    expect(rates.referenceDate).toBe('2026-09-30');
    expect(rates.byCurrency.get('EUR')).toBeCloseTo(0.860437, 6);
  });

  it('treats a non-2xx response as a failure', async () => {
    const ecb = feed(
      new Response('unavailable', {
        status: 503,
        statusText: 'Service Unavailable',
      }),
    );

    const outcome = await tick(ecb.impl, minutesAfter(0));

    expect(outcome.kind).toBe('rates_failed');
    expect((await readRates(db())).referenceDate).toBeNull();
  });

  it('does not retry a failing source every minute', async () => {
    const ecb = feed(new Error('network down'));

    await tick(ecb.impl, minutesAfter(0));
    await tick(ecb.impl, minutesAfter(1));
    await tick(ecb.impl, minutesAfter(2));

    expect(ecb.calls()).toBe(1);
  });

  it('clears expired carts and leaves live ones alone', async () => {
    const ecb = feed(new Error('not the subject of this test'));
    await insertCart('a'.repeat(32), '2026-09-01T00:00:00.000Z');
    await insertCart('b'.repeat(32), '2026-12-01T00:00:00.000Z');

    await tick(ecb.impl, minutesAfter(0)); // the rates attempt
    const cleaned = await tick(ecb.impl, minutesAfter(1));

    expect(cleaned).toEqual({ kind: 'carts_cleaned', deleted: 1 });
    const carts = await db()
      .prepare('SELECT id FROM p_shop_cart')
      .all<{ id: string }>();
    expect(carts.results.map((row) => row.id)).toEqual(['b'.repeat(32)]);
    const lines = await db()
      .prepare('SELECT cart_id FROM p_shop_cart_line')
      .all<{ cart_id: string }>();
    expect(lines.results.map((row) => row.cart_id)).toEqual(['b'.repeat(32)]);
  });
});
