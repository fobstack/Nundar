import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readRates } from '../../src/plugins/shop/lib/rates.js';
import { runScheduledTick } from '../../src/plugins/shop/lib/scheduled.js';
import {
  clearShopTables,
  createVariant,
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

function tick(
  fetchImpl: typeof fetch,
  now: () => Date,
  purgeTags?: (tags: readonly string[]) => Promise<unknown>,
) {
  return runScheduledTick(
    {
      db: db(),
      settings: {},
      ...(purgeTags === undefined ? {} : { purgeTags }),
    },
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

  describe('the pages a repricing run leaves out of date', () => {
    /** Two products with a variant each, and one variant priced by hand. */
    async function catalogue(): Promise<void> {
      for (const [id, group] of [
        ['a1', 'group-a'],
        ['a2', 'group-a'],
        ['b1', 'group-b'],
        ['c1', 'group-c'],
      ] as const) {
        await createVariant({ id, productGroup: group });
        await setPrice({
          variantId: id,
          currency: 'USD',
          amountMinor: 9900,
          source: 'base',
        });
      }
      // Every other currency of this one is the seller's own figure.
      for (const currency of ['EUR', 'GBP']) {
        await setPrice({
          variantId: 'c1',
          currency,
          amountMinor: 8000,
          source: 'manual',
        });
      }
    }

    it('are purged by product, in one call for the whole chunk', async () => {
      await catalogue();
      const ecb = feed(ecbXml('2026-09-30', 1.1622, 0.85898));
      const purges: string[][] = [];
      const purge = async (tags: readonly string[]) => {
        purges.push([...tags]);
      };

      await tick(ecb.impl, minutesAfter(0), purge);
      // Storing rates moves no price: nothing to purge yet.
      expect(purges).toEqual([]);

      const repriced = await tick(ecb.impl, minutesAfter(1), purge);

      expect(repriced).toMatchObject({ kind: 'repriced', purged: 2 });
      // Each product once, however many of its variants moved; and not the
      // product whose prices were entered by hand and did not move.
      expect(purges.map((tags) => [...tags].sort())).toEqual([
        ['group-a', 'group-b'],
      ]);
    });

    it('are left alone when no price moved', async () => {
      await catalogue();
      const purges: string[][] = [];
      const purge = async (tags: readonly string[]) => {
        purges.push([...tags]);
      };
      await tick(
        feed(ecbXml('2026-09-30', 1.1622, 0.85898)).impl,
        minutesAfter(0),
        purge,
      );
      await tick(feed().impl, minutesAfter(1), purge);
      purges.length = 0;

      // A day later the rate has barely moved: inside the threshold.
      await tick(
        feed(ecbXml('2026-10-01', 1.163, 0.859)).impl,
        minutesAfter(24 * 60),
        purge,
      );
      const second = await tick(feed().impl, minutesAfter(24 * 60 + 1), purge);

      expect(second).toMatchObject({ kind: 'repriced', updated: 0, purged: 0 });
      expect(purges).toEqual([]);
    });

    it('do not stop the run when the purge fails', async () => {
      await catalogue();
      const ecb = feed(ecbXml('2026-09-30', 1.1622, 0.85898));
      const failing = async () => {
        throw new Error('The purge service is down.');
      };
      await tick(ecb.impl, minutesAfter(0), failing);

      const repriced = await tick(ecb.impl, minutesAfter(1), failing);

      // The prices are written and the run is over; the pages expire.
      expect(repriced).toMatchObject({
        kind: 'repriced',
        updated: 6,
        purged: 0,
        done: true,
      });
      expect(await priceOf('a1', 'EUR')).toMatchObject({ source: 'auto' });
      // The run is over: the next tick goes on to something else.
      expect((await tick(feed().impl, minutesAfter(2), failing)).kind).not.toBe(
        'repriced',
      );
    });

    it.each([
      ['was not attempted', { attempted: false, ok: false }],
      ['was turned down', { attempted: true, ok: false, detail: '429' }],
    ])('are not counted as purged when the purge %s', async (_how, answer) => {
      // Mallok's purge resolves either way. A tick that only caught a
      // rejection would report pages purged that were not.
      await catalogue();
      const ecb = feed(ecbXml('2026-09-30', 1.1622, 0.85898));
      const purge = async () => answer;
      await tick(ecb.impl, minutesAfter(0), purge);

      expect(await tick(ecb.impl, minutesAfter(1), purge)).toMatchObject({
        kind: 'repriced',
        updated: 6,
        purged: 0,
        done: true,
      });
    });

    it('are counted when the purge says it was done', async () => {
      await catalogue();
      const ecb = feed(ecbXml('2026-09-30', 1.1622, 0.85898));
      const purge = async () => ({ attempted: true, ok: true });
      await tick(ecb.impl, minutesAfter(0), purge);

      expect(await tick(ecb.impl, minutesAfter(1), purge)).toMatchObject({
        kind: 'repriced',
        purged: 2,
      });
    });

    it('are not asked for where there is nothing to purge with', async () => {
      await catalogue();
      const ecb = feed(ecbXml('2026-09-30', 1.1622, 0.85898));
      await tick(ecb.impl, minutesAfter(0));

      expect(await tick(ecb.impl, minutesAfter(1))).toMatchObject({
        kind: 'repriced',
        updated: 6,
        purged: 0,
      });
    });

    it('leave out a price whose variant no longer exists', async () => {
      // A price row left behind by a variant that is gone names no product.
      await setPrice({
        variantId: 'orphan',
        currency: 'USD',
        amountMinor: 9900,
        source: 'base',
      });
      const ecb = feed(ecbXml('2026-09-30', 1.1622, 0.85898));
      const purges: string[][] = [];
      const purge = async (tags: readonly string[]) => {
        purges.push([...tags]);
      };
      await tick(ecb.impl, minutesAfter(0), purge);

      const repriced = await tick(ecb.impl, minutesAfter(1), purge);

      expect(repriced).toMatchObject({
        kind: 'repriced',
        updated: 2,
        purged: 0,
      });
      expect(purges).toEqual([]);
    });
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

  it('deletes every link to a buyer’s orders that no longer opens, however many', async () => {
    // Each holds the address typed into the form, kept for the day the link
    // is good and no longer. A request is recorded whether or not the
    // address has bought, and many visitors can ask in an hour.
    const ecb = feed(new Error('not the subject of this test'));
    const rows = Array.from({ length: 180 }, (_, index) => ({
      id: index.toString(16).padStart(64, '0'),
      email: `asker${index}@buyer.example`,
      expires_at:
        index < 170 ? '2026-09-01T00:00:00.000Z' : '2099-01-01T00:00:00.000Z',
    }));
    await db().batch(
      rows.map((row) =>
        db()
          .prepare(
            `INSERT INTO p_shop_order_link (id, email, ip_hash, created_at, expires_at)
             VALUES (?, ?, NULL, '2026-08-31T00:00:00.000Z', ?)`,
          )
          .bind(row.id, row.email, row.expires_at),
      ),
    );

    await tick(ecb.impl, minutesAfter(0)); // the rates attempt
    await tick(ecb.impl, minutesAfter(1));

    const left = await db()
      .prepare('SELECT COUNT(*) AS n FROM p_shop_order_link')
      .first<{ n: number }>();
    expect(left?.n).toBe(10);
  });
});

describe('the scheduled tick, for orders', () => {
  beforeAll(ensureSite);
  beforeEach(clearShopTables);

  /** An order written straight into the table, as old as the test says. */
  async function pendingOrder(
    id: string,
    createdAt: Date,
    sessionLapsesAt: Date | null,
  ): Promise<void> {
    await db()
      .prepare(
        `INSERT INTO p_shop_order
           (id, order_no, status, currency, subtotal_minor, shipping_minor,
            tax_minor, total_minor, email, shipping_address, locale,
            stripe_session_expires_at, created_at, updated_at)
         VALUES (?, ?, 'pending', 'USD', 1000, 0, 0, 1000, 'a@b.example', '{}',
                 'en', ?, ?, ?)`,
      )
      .bind(
        id,
        `ND-261001-${id.toUpperCase().padEnd(8, 'X').slice(0, 8)}`,
        sessionLapsesAt?.toISOString() ?? null,
        createdAt.toISOString(),
        createdAt.toISOString(),
      )
      .run();
  }

  async function statuses(): Promise<Record<string, string>> {
    const { results } = await db()
      .prepare('SELECT id, status FROM p_shop_order ORDER BY id')
      .all<{ id: string; status: string }>();
    return Object.fromEntries(results.map((row) => [row.id, row.status]));
  }

  const quiet = (() => {
    throw new Error('No fetch in these ticks');
  }) as unknown as typeof fetch;

  it('closes an order whose payment page lapsed an hour ago and never heard back', async () => {
    const now = minutesAfter(0)();
    const hour = 60 * 60 * 1000;
    await pendingOrder(
      'lapsed',
      new Date(now.getTime() - 3 * hour),
      new Date(now.getTime() - hour - 1),
    );
    await pendingOrder(
      'fresh',
      new Date(now.getTime() - hour),
      new Date(now.getTime() - 60_000),
    );
    await pendingOrder(
      'unrecorded',
      new Date(now.getTime() - 2 * hour - 1),
      null,
    );
    await pendingOrder('young', new Date(now.getTime() - hour), null);
    await db()
      .prepare(
        "INSERT INTO p_shop_state (key, value, updated_at) VALUES ('rates_attempted_at', ?, ?)",
      )
      .bind(now.toISOString(), now.toISOString())
      .run();

    const outcome = await runScheduledTick(
      { db: db(), settings: {} },
      { fetch: quiet, now: () => now },
    );

    expect(outcome).toEqual({ kind: 'orders_lapsed', cancelled: 2 });
    expect(await statuses()).toEqual({
      fresh: 'pending',
      lapsed: 'cancelled',
      unrecorded: 'cancelled',
      young: 'pending',
    });
    // Lapsed: nobody is written to about it.
    const refs = await db()
      .prepare('SELECT ref FROM p_shop_outbox ORDER BY seq')
      .all<{ ref: string }>();
    expect(refs.results.map((row) => row.ref)).toEqual(['expired', 'expired']);
  });

  it('looks for lapsed orders every ten minutes, not every one', async () => {
    const start = minutesAfter(0)();
    await db()
      .prepare(
        "INSERT INTO p_shop_state (key, value, updated_at) VALUES ('rates_attempted_at', ?, ?)",
      )
      .bind(start.toISOString(), start.toISOString())
      .run();

    await runScheduledTick(
      { db: db(), settings: {} },
      { fetch: quiet, now: () => start },
    );
    await pendingOrder(
      'lapsed',
      new Date(start.getTime() - 4 * 60 * 60 * 1000),
      new Date(start.getTime() - 2 * 60 * 60 * 1000),
    );

    await runScheduledTick(
      { db: db(), settings: {} },
      { fetch: quiet, now: minutesAfter(5) },
    );
    expect((await statuses()).lapsed).toBe('pending');
    const later = await runScheduledTick(
      { db: db(), settings: {} },
      { fetch: quiet, now: minutesAfter(10) },
    );
    expect(later).toEqual({ kind: 'orders_lapsed', cancelled: 1 });
  });

  it('carries out what an order owes once its own job has had five minutes', async () => {
    const now = minutesAfter(0)();
    await pendingOrder('cancelled-one', now, null);
    await db()
      .prepare(
        `INSERT INTO p_shop_outbox (id, topic, order_id, ref, created_at)
         VALUES ('order.cancelled:recent', 'order.cancelled', 'cancelled-one', 'seller', ?),
                ('order.cancelled:old', 'order.cancelled', 'cancelled-one', 'seller', ?)`,
      )
      .bind(
        new Date(now.getTime() - 60_000).toISOString(),
        new Date(now.getTime() - 6 * 60_000).toISOString(),
      )
      .run();
    const sent: string[] = [];

    const outcome = await runScheduledTick(
      {
        db: db(),
        settings: {},
        site: { defaultLocale: 'en' },
        sendEmail: async (message) => {
          sent.push(message.subject);
          return 'job';
        },
      },
      { fetch: quiet, now: () => now },
    );

    expect(outcome).toEqual({ kind: 'follow_ups', handled: 1, failed: 0 });
    expect(sent).toEqual(['Order ND-261001-CANCELLE cancelled']);
    const left = await db()
      .prepare('SELECT id FROM p_shop_outbox WHERE handled_at IS NULL')
      .all<{ id: string }>();
    expect(left.results.map((row) => row.id)).toEqual([
      'order.cancelled:recent',
    ]);
  });

  it('asks Stripe before closing an order with a page, and leaves one Stripe has paid', async () => {
    const now = minutesAfter(0)();
    const hour = 60 * 60 * 1000;
    for (const id of ['paid-late', 'expired', 'no-answer']) {
      await pendingOrder(
        id,
        new Date(now.getTime() - 3 * hour),
        new Date(now.getTime() - 2 * hour),
      );
      await db()
        .prepare('UPDATE p_shop_order SET stripe_session_id = ? WHERE id = ?')
        .bind(`cs_${id}`, id)
        .run();
    }
    await db()
      .prepare(
        "INSERT INTO p_shop_state (key, value, updated_at) VALUES ('rates_attempted_at', ?, ?)",
      )
      .bind(now.toISOString(), now.toISOString())
      .run();
    const asked: string[] = [];
    const stripe = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      asked.push(url.pathname);
      if (url.pathname.endsWith('/expire')) {
        return Response.json(
          { error: { type: 'invalid_request_error' } },
          { status: 400 },
        );
      }
      if (url.pathname.endsWith('cs_no-answer')) {
        return new Response('', { status: 503 });
      }
      return Response.json({
        id: 'x',
        status: url.pathname.endsWith('cs_paid-late') ? 'complete' : 'expired',
      });
    }) as unknown as typeof fetch;

    const outcome = await runScheduledTick(
      {
        db: db(),
        settings: {},
        secrets: { stripe_secret_key: 'sk_test_sweep' },
      },
      { fetch: stripe, now: () => now },
    );

    expect(outcome).toEqual({ kind: 'orders_lapsed', cancelled: 1 });
    expect(await statuses()).toEqual({
      expired: 'cancelled',
      'no-answer': 'pending',
      'paid-late': 'pending',
    });
    expect(asked).toContain('/v1/checkout/sessions/cs_paid-late');
  });

  it('leaves an order with a page alone when there is no key to ask Stripe with', async () => {
    const now = minutesAfter(0)();
    await pendingOrder(
      'keyless',
      new Date(now.getTime() - 4 * 60 * 60 * 1000),
      new Date(now.getTime() - 3 * 60 * 60 * 1000),
    );
    await db()
      .prepare("UPDATE p_shop_order SET stripe_session_id = 'cs_keyless'")
      .run();
    await db()
      .prepare(
        "INSERT INTO p_shop_state (key, value, updated_at) VALUES ('rates_attempted_at', ?, ?)",
      )
      .bind(now.toISOString(), now.toISOString())
      .run();

    await runScheduledTick(
      { db: db(), settings: {} },
      { fetch: quiet, now: () => now },
    );

    expect(await statuses()).toEqual({ keyless: 'pending' });
  });
});
