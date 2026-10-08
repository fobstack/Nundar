/**
 * Variants, as the admin edits them.
 *
 * The admin shows a `records` panel under the editor of every product, and
 * the admin never writes to a plugin's table: opening a variant calls `load`
 * here, saving calls `save`, deleting calls `remove`. Mallok has already
 * checked each value against the field it was declared as in `plugin.json`;
 * what is checked here is what only the shop can judge — a SKU that is taken,
 * a lead time that ends before it starts, a currency priced twice.
 *
 * A variant is one row of `p_shop_variant` and its rows of `p_shop_price`:
 *
 * - `price` is the base price, in the base currency.
 * - `other_prices` are the prices entered by hand in other currencies. They
 *   are stored as `manual` and nothing recomputes them.
 * - A currency with neither is derived from the base price at the stored
 *   exchange rate, as `auto`. That happens here when the base price changes,
 *   and otherwise only when the rate has drifted (`lib/rates.ts`): saving a
 *   variant for another reason must not make its prices twitch.
 *
 * Stock is set to a figure, and the stock ledger records the difference.
 */

import type {
  ContentDeleteRef,
  PluginContext,
  PluginRecordInput,
  PluginRecordSaved,
} from 'mallok/worker';
import {
  BASE_CURRENCY,
  CURRENCIES,
  type Currency,
  isCurrency,
} from './currency.js';
import { convertPrice, pricingRulesFromSettings } from './pricing.js';
import { readRatesStatement, toStoredRates } from './rates.js';
import { productCacheTag } from './render-data.js';

/** The kind whose editor the panel is attached to. */
const PRODUCT_KIND = 'product';

interface VariantRow {
  id: string;
  product_group: string;
  sku: string;
  option_values: string;
  moq: number;
  lead_time_min: number | null;
  lead_time_max: number | null;
  stock: number;
  stock_policy: string;
  weight_grams: number | null;
  status: string;
  sort_order: number;
}

interface PriceRow {
  currency: string;
  amount_minor: number;
  source: string;
}

interface Money {
  readonly amount: number;
  readonly currency: Currency;
}

function isMoney(value: unknown): value is Money {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const { amount, currency } = value as {
    amount?: unknown;
    currency?: unknown;
  };
  return (
    typeof amount === 'number' &&
    Number.isInteger(amount) &&
    amount >= 0 &&
    typeof currency === 'string' &&
    isCurrency(currency)
  );
}

/** A whole number at least `min`, or null when the value is not one. */
function whole(value: unknown, min: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min
    ? value
    : null;
}

/** Option name to value, as stored: strings only, blanks dropped. */
function options(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const kept: Record<string, string> = {};
  for (const [name, entry] of Object.entries(value)) {
    if (
      typeof entry === 'string' &&
      name.trim() !== '' &&
      entry.trim() !== ''
    ) {
      kept[name.trim()] = entry.trim();
    }
  }
  return kept;
}

function parseOptions(stored: string): Record<string, string> {
  try {
    return options(JSON.parse(stored));
  } catch {
    return {};
  }
}

function purgeFailed(error: unknown): void {
  // The change is saved; the pages show it when their cache entry runs out.
  // Worth a line, not a failed save.
  console.log(
    JSON.stringify({
      event: 'shop_purge_failed',
      reason: error instanceof Error ? error.name : 'unknown',
    }),
  );
}

/**
 * Asks for a product's pages to be purged, and does not wait for it.
 *
 * Mallok gathers the purges of two seconds into one call. A save that waited
 * for its purge would keep the seller looking at a spinner for those two
 * seconds, every time; the request is answered and the purge is left to
 * finish behind it. One that fails leaves the pages to expire.
 */
function purgeProduct(ctx: PluginContext, group: string): void {
  try {
    ctx.waitUntil(ctx.purgeTags([productCacheTag(group)]).catch(purgeFailed));
  } catch (error) {
    purgeFailed(error);
  }
}

/** The record for the edit form, in the shape `save` takes. */
export async function loadVariant(
  id: string,
  ctx: PluginContext,
): Promise<Readonly<Record<string, unknown>> | null> {
  const [variantResult, priceResult] = await ctx.db.batch<
    VariantRow | PriceRow
  >([
    ctx.db
      .prepare(
        `SELECT id, product_group, sku, option_values, moq, lead_time_min,
                  lead_time_max, stock, stock_policy, weight_grams, status,
                  sort_order
           FROM p_shop_variant WHERE id = ?`,
      )
      .bind(id),
    ctx.db
      .prepare(
        `SELECT currency, amount_minor, source FROM p_shop_price
           WHERE variant_id = ? ORDER BY currency`,
      )
      .bind(id),
  ]);
  const variant = (variantResult?.results ?? [])[0] as VariantRow | undefined;
  if (variant === undefined) {
    return null;
  }
  const prices = (priceResult?.results ?? []) as PriceRow[];
  const base = prices.find(
    (row) => row.currency === BASE_CURRENCY && row.source === 'base',
  );
  return {
    sku: variant.sku,
    options: parseOptions(variant.option_values),
    status: variant.status,
    moq: variant.moq,
    stock_policy: variant.stock_policy,
    stock: variant.stock,
    lead_time_min: variant.lead_time_min,
    lead_time_max: variant.lead_time_max,
    weight_grams: variant.weight_grams,
    sort_order: variant.sort_order,
    price:
      base === undefined
        ? null
        : { amount: base.amount_minor, currency: BASE_CURRENCY },
    // Only what was entered by hand: a derived price is the shop's own doing
    // and would become a hand-entered one if the form sent it back.
    other_prices: prices
      .filter((row) => row.source === 'manual' && isCurrency(row.currency))
      .map((row) => ({
        price: { amount: row.amount_minor, currency: row.currency },
      })),
  };
}

export async function saveVariant(
  record: PluginRecordInput,
  ctx: PluginContext,
  now: Date = new Date(),
): Promise<PluginRecordSaved> {
  const { values } = record;
  const errors: Record<string, string> = {};

  const sku = typeof values.sku === 'string' ? values.sku.trim() : '';
  if (sku === '') {
    errors.sku = 'A variant needs a SKU.';
  }
  const moq = whole(values.moq ?? 1, 1);
  if (moq === null) {
    errors.moq = 'The minimum order is a whole number, 1 or more.';
  }
  const stock = whole(values.stock ?? 0, 0);
  if (stock === null) {
    errors.stock = 'Stock is a whole number, 0 or more.';
  }
  const leadMin =
    values.lead_time_min === null || values.lead_time_min === undefined
      ? null
      : whole(values.lead_time_min, 0);
  const leadMax =
    values.lead_time_max === null || values.lead_time_max === undefined
      ? null
      : whole(values.lead_time_max, 0);
  if ((values.lead_time_min ?? null) !== null && leadMin === null) {
    errors.lead_time_min = 'A lead time is a whole number of business days.';
  }
  if ((values.lead_time_max ?? null) !== null && leadMax === null) {
    errors.lead_time_max = 'A lead time is a whole number of business days.';
  }
  // A page states a lead time only when it has both ends, in order.
  if ((leadMin === null) !== (leadMax === null)) {
    errors[leadMin === null ? 'lead_time_min' : 'lead_time_max'] =
      'Give both ends of the lead time, or neither.';
  } else if (leadMin !== null && leadMax !== null && leadMax < leadMin) {
    errors.lead_time_max =
      'The longest lead time cannot be shorter than the shortest.';
  }
  const weight =
    values.weight_grams === null || values.weight_grams === undefined
      ? null
      : whole(values.weight_grams, 0);
  if ((values.weight_grams ?? null) !== null && weight === null) {
    errors.weight_grams = 'Weight is a whole number of grams.';
  }
  const sortOrder =
    values.sort_order === null || values.sort_order === undefined
      ? 0
      : typeof values.sort_order === 'number' &&
          Number.isInteger(values.sort_order)
        ? values.sort_order
        : null;
  if (sortOrder === null) {
    errors.sort_order = 'The position is a whole number.';
  }
  const status = values.status === 'archived' ? 'archived' : 'active';
  const stockPolicy =
    values.stock_policy === 'made_to_order' ? 'made_to_order' : 'track';

  let base: Money | null = null;
  if (values.price !== null && values.price !== undefined) {
    if (isMoney(values.price) && values.price.currency === BASE_CURRENCY) {
      base = values.price;
    } else {
      errors.price = `The base price is an amount in ${BASE_CURRENCY}.`;
    }
  }

  // The prices entered by hand, one for each currency other than the base.
  const manual = new Map<Currency, number>();
  const rows = Array.isArray(values.other_prices) ? values.other_prices : [];
  rows.forEach((row, index) => {
    const price = (row as { price?: unknown } | null)?.price;
    const key = `other_prices.${index}.price`;
    if (!isMoney(price)) {
      errors[key] = 'Give an amount and a currency.';
    } else if (price.currency === BASE_CURRENCY) {
      errors[key] = `${BASE_CURRENCY} is the base price, above.`;
    } else if (manual.has(price.currency)) {
      errors[key] = `${price.currency} is already priced in another row.`;
    } else {
      manual.set(price.currency, price.amount);
    }
  });

  if (record.id === null && record.attachedTo === null) {
    // The panel is attached to products; a variant of nothing cannot exist.
    errors.sku ??=
      'A variant belongs to a product: add it from the product’s own page.';
  }
  if (
    Object.keys(errors).length > 0 ||
    moq === null ||
    stock === null ||
    sortOrder === null
  ) {
    return { errors };
  }

  // One round trip: the variant as it stands, its prices and the stored
  // rates. Whether the SKU is free is not asked here: the table's own
  // constraint is the answer, at the moment of the write (below).
  const [existingResult, priceResult, rateResult] = await ctx.db.batch<
    | VariantRow
    | PriceRow
    | { quote_currency: string; rate: number; reference_date: string }
  >([
    ctx.db
      .prepare(
        `SELECT id, product_group, sku, option_values, moq, lead_time_min,
                  lead_time_max, stock, stock_policy, weight_grams, status,
                  sort_order
           FROM p_shop_variant WHERE id = ?`,
      )
      .bind(record.id ?? ''),
    ctx.db
      .prepare(
        `SELECT currency, amount_minor, source FROM p_shop_price
           WHERE variant_id = ?`,
      )
      .bind(record.id ?? ''),
    readRatesStatement(ctx.db),
  ]);

  const existing = (existingResult?.results ?? [])[0] as VariantRow | undefined;
  if (record.id !== null && existing === undefined) {
    return { errors: { sku: 'This variant no longer exists.' } };
  }
  const group = existing?.product_group ?? record.attachedTo?.translationGroup;
  if (group === undefined) {
    return { errors: { sku: 'A variant belongs to a product.' } };
  }
  if (
    existing !== undefined &&
    record.attachedTo !== null &&
    record.attachedTo.translationGroup !== existing.product_group
  ) {
    // The form of one product, saving a variant of another.
    return { errors: { sku: 'This variant belongs to another product.' } };
  }

  const stored = (priceResult?.results ?? []) as PriceRow[];
  const storedBase = stored.find((row) => row.source === 'base');
  const rates = toStoredRates(
    (rateResult?.results ?? []) as {
      quote_currency: string;
      rate: number;
      reference_date: string;
    }[],
  );
  const rules = pricingRulesFromSettings(ctx.settings);

  const id = existing?.id ?? crypto.randomUUID();
  const nowIso = now.toISOString();
  const { db } = ctx;
  const statements: D1PreparedStatement[] = [];

  if (existing === undefined) {
    statements.push(
      db
        .prepare(
          `INSERT INTO p_shop_variant
             (id, product_group, sku, option_values, moq, lead_time_min,
              lead_time_max, stock, stock_policy, weight_grams, status,
              sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          group,
          sku,
          JSON.stringify(options(values.options)),
          moq,
          leadMin,
          leadMax,
          stock,
          stockPolicy,
          weight,
          status,
          sortOrder,
          nowIso,
          nowIso,
        ),
    );
    if (stock > 0) {
      statements.push(
        db
          .prepare(
            `INSERT INTO p_shop_stock_adjustment
               (id, variant_id, delta, reason, ref_id, created_at)
             VALUES (?, ?, ?, 'manual', NULL, ?)`,
          )
          .bind(`manual:${crypto.randomUUID()}`, id, stock, nowIso),
      );
    }
  } else {
    // The ledger row first, while the old figure is still in the table: the
    // difference is taken from the stock as it is when this batch runs, not
    // as it was when the form was opened.
    statements.push(
      db
        .prepare(
          `INSERT INTO p_shop_stock_adjustment
             (id, variant_id, delta, reason, ref_id, created_at)
           SELECT ?, id, ? - stock, 'manual', NULL, ?
           FROM p_shop_variant WHERE id = ? AND stock <> ?`,
        )
        .bind(`manual:${crypto.randomUUID()}`, stock, nowIso, id, stock),
      db
        .prepare(
          `UPDATE p_shop_variant SET
             sku = ?, option_values = ?, moq = ?, lead_time_min = ?,
             lead_time_max = ?, stock = ?, stock_policy = ?, weight_grams = ?,
             status = ?, sort_order = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(
          sku,
          JSON.stringify(options(values.options)),
          moq,
          leadMin,
          leadMax,
          stock,
          stockPolicy,
          weight,
          status,
          sortOrder,
          nowIso,
          id,
        ),
    );
  }

  const upsertPrice = (
    currency: Currency,
    amount: number,
    source: 'base' | 'manual' | 'auto',
    rateUsed: number | null,
  ): D1PreparedStatement =>
    db
      .prepare(
        `INSERT INTO p_shop_price
           (variant_id, currency, amount_minor, source, rate_used, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (variant_id, currency) DO UPDATE SET
           amount_minor = excluded.amount_minor, source = excluded.source,
           rate_used = excluded.rate_used, updated_at = excluded.updated_at`,
      )
      .bind(id, currency, amount, source, rateUsed, nowIso);

  if (base === null) {
    // No base price: nothing to derive from, and a price entered by hand in
    // another currency still stands.
    statements.push(
      db
        .prepare(
          "DELETE FROM p_shop_price WHERE variant_id = ? AND source <> 'manual'",
        )
        .bind(id),
    );
  } else {
    statements.push(upsertPrice(BASE_CURRENCY, base.amount, 'base', null));
  }
  for (const currency of CURRENCIES) {
    if (currency === BASE_CURRENCY) {
      continue;
    }
    const byHand = manual.get(currency);
    if (byHand !== undefined) {
      statements.push(upsertPrice(currency, byHand, 'manual', null));
      continue;
    }
    const was = stored.find((row) => row.currency === currency);
    const rate = rates.byCurrency.get(currency);
    if (base === null || rate === undefined) {
      // Nothing to derive it from. A hand-entered price that was taken off
      // the form goes; a derived one went with the base price above.
      if (was?.source === 'manual') {
        statements.push(
          db
            .prepare(
              'DELETE FROM p_shop_price WHERE variant_id = ? AND currency = ?',
            )
            .bind(id, currency),
        );
      }
      continue;
    }
    // Derived again only when what it is derived from changed, or when
    // there is no derived price to keep.
    if (
      was?.source === 'auto' &&
      storedBase !== undefined &&
      storedBase.amount_minor === base.amount
    ) {
      continue;
    }
    statements.push(
      upsertPrice(
        currency,
        convertPrice({ baseMinor: base.amount, rate, currency, rules }),
        'auto',
        rate,
      ),
    );
  }

  try {
    await db.batch(statements);
  } catch (error) {
    // The one failure a seller can cause: another variant has the SKU, and
    // the table refused the write. Read to find out rather than trust the
    // text of an error.
    const taken = await db
      .prepare('SELECT id FROM p_shop_variant WHERE sku = ? AND id <> ?')
      .bind(sku, id)
      .first<{ id: string }>();
    if (taken !== null) {
      return { errors: { sku: 'Another variant already has this SKU.' } };
    }
    throw error;
  }

  purgeProduct(ctx, group);
  return { id };
}

/**
 * Deletes a variant that was entered by mistake — or, if it has ever been
 * ordered, archives it.
 *
 * An order's lines and the stock ledger name a variant, and a payment or a
 * refund still to come looks for its stock, so one that is on an order is
 * never deleted. Archiving takes it off every page and out of every cart
 * just the same. It is done rather than refused because a `remove` handler
 * has no way to say why it will not: all it can do is throw, and the admin
 * then shows a failure with no reason. The seller sees the variant still
 * listed, as archived.
 */
export async function removeVariant(
  id: string,
  ctx: PluginContext,
  now: Date = new Date(),
): Promise<void> {
  const variant = await ctx.db
    .prepare('SELECT product_group FROM p_shop_variant WHERE id = ?')
    .bind(id)
    .first<{ product_group: string }>();
  if (variant === null) {
    return;
  }
  // The same condition in every statement, read when the batch runs: an
  // order placed a moment ago keeps the variant and its prices.
  const unordered =
    'NOT EXISTS (SELECT 1 FROM p_shop_order_line WHERE variant_id = ?)';
  await ctx.db.batch([
    ctx.db
      .prepare('DELETE FROM p_shop_cart_line WHERE variant_id = ?')
      .bind(id),
    ctx.db
      .prepare(`DELETE FROM p_shop_price WHERE variant_id = ? AND ${unordered}`)
      .bind(id, id),
    ctx.db
      .prepare(`DELETE FROM p_shop_variant WHERE id = ? AND ${unordered}`)
      .bind(id, id),
    // Whatever is left was on an order.
    ctx.db
      .prepare(
        `UPDATE p_shop_variant SET status = 'archived', updated_at = ?
         WHERE id = ? AND status <> 'archived'`,
      )
      .bind(now.toISOString(), id),
  ]);
  purgeProduct(ctx, variant.product_group);
}

/**
 * A product was deleted. When its last language has gone, so has everything
 * that could be bought of it: its variants leave every cart, those never
 * ordered are deleted with their prices, and those on an order are archived,
 * for the order and the ledger to keep naming.
 *
 * Mallok calls this after the content is gone and cannot be told no. It is
 * safe to run again: every statement is a no-op the second time.
 */
export async function onProductDeleted(
  ref: ContentDeleteRef,
  ctx: PluginContext,
  now: Date = new Date(),
): Promise<void> {
  if (ref.kind !== PRODUCT_KIND || !ref.lastInGroup) {
    return;
  }
  const group = ref.translationGroup;
  const ofGroup = 'SELECT id FROM p_shop_variant WHERE product_group = ?';
  const ordered = 'SELECT variant_id FROM p_shop_order_line';
  await ctx.db.batch([
    ctx.db
      .prepare(`DELETE FROM p_shop_cart_line WHERE variant_id IN (${ofGroup})`)
      .bind(group),
    ctx.db
      .prepare(
        `DELETE FROM p_shop_price
         WHERE variant_id IN (${ofGroup}) AND variant_id NOT IN (${ordered})`,
      )
      .bind(group),
    ctx.db
      .prepare(
        `DELETE FROM p_shop_variant
         WHERE product_group = ? AND id NOT IN (${ordered})`,
      )
      .bind(group),
    ctx.db
      .prepare(
        `UPDATE p_shop_variant SET status = 'archived', updated_at = ?
         WHERE product_group = ? AND status <> 'archived'`,
      )
      .bind(now.toISOString(), group),
  ]);
  purgeProduct(ctx, group);
}
