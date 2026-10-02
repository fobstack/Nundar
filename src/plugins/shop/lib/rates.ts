/**
 * Exchange-rate snapshots and the repricing they drive.
 *
 * Three rules that do not bend:
 *
 * 1. The base-currency price is entered by a human and is the source of
 *    truth. It is never rewritten.
 * 2. A `manual` price is never rewritten: a price chosen for one market
 *    outranks whatever the exchange rate says.
 * 3. An `auto` price does not move until the rate has drifted past the
 *    threshold from the rate it was computed at.
 */

import {
  BASE_CURRENCY,
  CURRENCIES,
  type Currency,
  isCurrency,
} from './currency.js';
import {
  convertPrice,
  needsRecalculation,
  type PricingRules,
} from './pricing.js';

export interface StoredRates {
  /** The reference date of the stored snapshot; null when there is none. */
  readonly referenceDate: string | null;
  /** One unit of the base currency in each quote currency. */
  readonly byCurrency: ReadonlyMap<Currency, number>;
}

interface RateRow {
  quote_currency: string;
  rate: number;
  reference_date: string;
}

function ratesStatement(db: D1Database): D1PreparedStatement {
  return db
    .prepare(
      `SELECT quote_currency, rate, reference_date FROM p_shop_rate
       WHERE base_currency = ?`,
    )
    .bind(BASE_CURRENCY);
}

function toStoredRates(rows: readonly RateRow[]): StoredRates {
  const byCurrency = new Map<Currency, number>();
  let referenceDate: string | null = null;
  for (const row of rows) {
    if (isCurrency(row.quote_currency) && row.rate > 0) {
      byCurrency.set(row.quote_currency, row.rate);
      // The newest date wins if a previous fetch stored only some currencies.
      if (referenceDate === null || row.reference_date > referenceDate) {
        referenceDate = row.reference_date;
      }
    }
  }
  return { referenceDate, byCurrency };
}

export async function readRates(db: D1Database): Promise<StoredRates> {
  const { results } = await ratesStatement(db).all<RateRow>();
  return toStoredRates(results);
}

/**
 * Builds the statements that store a rate snapshot, one current row per
 * currency pair. Currencies the shop does not price in are ignored.
 */
export function storeRatesStatements(
  db: D1Database,
  input: {
    readonly rates: Readonly<Record<string, number>>;
    readonly referenceDate: string;
    readonly source: string;
    readonly now: Date;
  },
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (const [quote, rate] of Object.entries(input.rates)) {
    if (!isCurrency(quote) || quote === BASE_CURRENCY || !(rate > 0)) {
      continue;
    }
    statements.push(
      db
        .prepare(
          `INSERT INTO p_shop_rate
             (base_currency, quote_currency, rate, reference_date, fetched_at, source)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (base_currency, quote_currency) DO UPDATE SET
             rate = excluded.rate,
             reference_date = excluded.reference_date,
             fetched_at = excluded.fetched_at,
             source = excluded.source`,
        )
        .bind(
          BASE_CURRENCY,
          quote,
          rate,
          input.referenceDate,
          input.now.toISOString(),
          input.source,
        ),
    );
  }
  return statements;
}

export interface RepriceResult {
  /** Price rows recomputed and written. */
  readonly updated: number;
  /** Rows left alone because the rate had not drifted past the threshold. */
  readonly skipped: number;
  /** Rows left alone because they carry a manual price. */
  readonly manual: number;
  /** Variants whose price in some currency changed. */
  readonly changedVariantIds: readonly string[];
  /** Where the next chunk starts; null when the run is complete. */
  readonly nextCursor: string | null;
}

interface ChunkRow {
  variant_id: string;
  base_minor: number;
  currency: string | null;
  source: string | null;
  rate_used: number | null;
}

/**
 * Reprices one chunk of variants at the stored rates.
 *
 * A chunk, because this runs inside the site's once-a-minute cron, where every
 * plugin shares one invocation's CPU budget: a catalogue is repriced a little
 * each minute rather than all at once.
 *
 * It costs two round trips whatever the chunk size — one batched read, and one
 * write that carries every changed row as a single JSON parameter. Reading and
 * writing each price separately would pass D1's per-invocation query limit on
 * a catalogue of any size.
 */
export async function repriceChunk(
  db: D1Database,
  input: {
    readonly rules: PricingRules;
    /** The last variant id already processed; empty to start a run. */
    readonly cursor: string;
    readonly limit: number;
    readonly now: Date;
  },
): Promise<RepriceResult> {
  const [rateResult, chunkResult] = await db.batch<RateRow | ChunkRow>([
    ratesStatement(db),
    db
      .prepare(
        `SELECT b.variant_id AS variant_id, b.amount_minor AS base_minor,
                p.currency AS currency, p.source AS source,
                p.rate_used AS rate_used
         FROM (
           SELECT variant_id, amount_minor FROM p_shop_price
           WHERE currency = ? AND source = 'base' AND variant_id > ?
           ORDER BY variant_id LIMIT ?
         ) AS b
         LEFT JOIN p_shop_price AS p
           ON p.variant_id = b.variant_id AND p.currency <> ?
         ORDER BY b.variant_id`,
      )
      .bind(BASE_CURRENCY, input.cursor, input.limit, BASE_CURRENCY),
  ]);

  const rates = toStoredRates((rateResult?.results ?? []) as RateRow[]);
  const rows = (chunkResult?.results ?? []) as ChunkRow[];

  // Group the joined rows back into one entry per variant.
  const variants = new Map<
    string,
    { baseMinor: number; existing: Map<string, ChunkRow> }
  >();
  for (const row of rows) {
    let entry = variants.get(row.variant_id);
    if (entry === undefined) {
      entry = { baseMinor: row.base_minor, existing: new Map() };
      variants.set(row.variant_id, entry);
    }
    if (row.currency !== null) {
      entry.existing.set(row.currency, row);
    }
  }

  let skipped = 0;
  let manual = 0;
  const writes: { v: string; c: Currency; a: number; r: number }[] = [];
  const changed = new Set<string>();

  for (const [variantId, entry] of variants) {
    for (const currency of CURRENCIES) {
      if (currency === BASE_CURRENCY) {
        continue;
      }
      const rate = rates.byCurrency.get(currency);
      if (rate === undefined) {
        continue;
      }
      const existing = entry.existing.get(currency);
      if (existing?.source === 'manual') {
        manual += 1;
        continue;
      }
      if (
        existing !== undefined &&
        !needsRecalculation({
          rateUsed: existing.rate_used,
          currentRate: rate,
          threshold: input.rules.recalcThreshold,
        })
      ) {
        skipped += 1;
        continue;
      }
      writes.push({
        v: variantId,
        c: currency,
        a: convertPrice({
          baseMinor: entry.baseMinor,
          rate,
          currency,
          rules: input.rules,
        }),
        r: rate,
      });
      changed.add(variantId);
    }
  }

  if (writes.length > 0) {
    // One statement for the whole chunk. The trailing WHERE re-checks `manual`
    // at write time, so a price set by hand between the read above and this
    // write is still not overwritten.
    await db
      .prepare(
        `INSERT INTO p_shop_price
           (variant_id, currency, amount_minor, source, rate_used, updated_at)
         SELECT json_extract(value, '$.v'), json_extract(value, '$.c'),
                json_extract(value, '$.a'), 'auto',
                json_extract(value, '$.r'), ?
         FROM json_each(?)
         WHERE true
         ON CONFLICT (variant_id, currency) DO UPDATE SET
           amount_minor = excluded.amount_minor,
           source = 'auto',
           rate_used = excluded.rate_used,
           updated_at = excluded.updated_at
         WHERE p_shop_price.source <> 'manual'`,
      )
      .bind(input.now.toISOString(), JSON.stringify(writes))
      .run();
  }

  const lastVariantId = [...variants.keys()].at(-1);
  return {
    updated: writes.length,
    skipped,
    manual,
    changedVariantIds: [...changed],
    nextCursor:
      variants.size === input.limit && lastVariantId !== undefined
        ? lastVariantId
        : null,
  };
}
