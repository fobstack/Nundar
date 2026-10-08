/**
 * Pricing and validating a cart against current database values.
 *
 * This is the one authoritative calculation: price, stock and minimum order
 * quantity are all re-read here, and no amount supplied by a client takes
 * part. Every problem is reported at once, rather than surfacing one more each
 * time the buyer fixes something.
 */

import type { CartLine } from './cart.js';
import { BASE_CURRENCY, CURRENCIES, type Currency } from './currency.js';
import { sumMinor } from './money.js';

export interface PricedLine {
  readonly variantId: string;
  readonly sku: string;
  readonly name: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
}

export type CartIssue =
  | { readonly kind: 'empty' }
  | { readonly kind: 'unavailable'; readonly variantId: string }
  | { readonly kind: 'no_price'; readonly variantId: string }
  | {
      readonly kind: 'below_moq';
      readonly variantId: string;
      readonly moq: number;
      readonly requested: number;
    }
  | {
      readonly kind: 'insufficient_stock';
      readonly variantId: string;
      readonly available: number;
      readonly requested: number;
    };

export type PricedCart =
  | {
      readonly ok: true;
      readonly currency: Currency;
      readonly lines: readonly PricedLine[];
      readonly subtotalMinor: number;
    }
  | { readonly ok: false; readonly issues: readonly CartIssue[] };

export interface VariantRow {
  id: string;
  product_group: string;
  sku: string;
  moq: number;
  stock: number;
  stock_policy: string;
  status: string;
}

interface PriceRow {
  variant_id: string;
  currency: string;
  amount_minor: number;
}

interface TitleRow {
  translation_group: string;
  locale: string;
  title: string;
}

/**
 * Whether a quantity of one variant can be ordered, ignoring price.
 *
 * Shared by add-to-cart and by cart pricing so the two can never disagree
 * about what is orderable.
 */
export function quantityIssue(
  variant: VariantRow,
  quantity: number,
): CartIssue | null {
  if (variant.status !== 'active') {
    return { kind: 'unavailable', variantId: variant.id };
  }
  if (quantity < variant.moq) {
    return {
      kind: 'below_moq',
      variantId: variant.id,
      moq: variant.moq,
      requested: quantity,
    };
  }
  // A made-to-order variant is produced on demand, so stock does not limit it.
  if (variant.stock_policy === 'track' && quantity > variant.stock) {
    return {
      kind: 'insufficient_stock',
      variantId: variant.id,
      available: variant.stock,
      requested: quantity,
    };
  }
  return null;
}

/** One line of a cart, with everything current the database says of it. */
export interface CartLineFacts {
  readonly variantId: string;
  readonly quantity: number;
  /** Empty when the variant is gone. */
  readonly sku: string;
  /** The product's name in the buyer's language; null when it cannot be bought. */
  readonly name: string | null;
  /** 1 when the variant is gone: nothing can be ordered of it anyway. */
  readonly moq: number;
  /** The unit price in the currency the cart settles in; null when there is none. */
  readonly unitPriceMinor: number | null;
  /** Why this line cannot be ordered as it stands; null when it can. */
  readonly issue: CartIssue | null;
}

export interface CartFacts {
  /** The one currency every amount is in. */
  readonly currency: Currency;
  /** The currencies every line has a price in: what the cart could settle in. */
  readonly currencies: readonly Currency[];
  readonly lines: readonly CartLineFacts[];
}

/**
 * Reads everything a cart's lines depend on, in one round trip, and judges
 * each line: is it there, can that many be ordered, what does one cost.
 *
 * Nothing here is taken from the client but the variant ids and quantities.
 * `priceCart` turns the result into an order's lines or its list of
 * problems; the cart page shows it line by line, problems included.
 */
export async function readCartFacts(
  db: D1Database,
  input: {
    readonly lines: readonly CartLine[];
    readonly locale: string;
    readonly defaultLocale: string;
    readonly currency: Currency;
  },
): Promise<CartFacts> {
  const { lines, locale, defaultLocale, currency } = input;
  if (lines.length === 0) {
    return { currency, currencies: [], lines: [] };
  }

  const ids = JSON.stringify(lines.map((line) => line.variantId));

  // One batch, so pricing a cart costs one round trip however many lines.
  const [variantResult, priceResult, titleResult] = await db.batch<
    VariantRow | PriceRow | TitleRow
  >([
    db
      .prepare(
        `SELECT id, product_group, sku, moq, stock, stock_policy, status
         FROM p_shop_variant
         WHERE id IN (SELECT value FROM json_each(?))`,
      )
      .bind(ids),
    db
      .prepare(
        `SELECT variant_id, currency, amount_minor FROM p_shop_price
         WHERE variant_id IN (SELECT value FROM json_each(?))`,
      )
      .bind(ids),
    // Only a published product can be bought. The name comes from the buyer's
    // language, falling back to the site's default language.
    db
      .prepare(
        `SELECT c.translation_group AS translation_group, c.locale AS locale,
                c.title AS title
         FROM content AS c
         WHERE c.status = 'published'
           AND c.locale IN (?, ?)
           AND c.translation_group IN (
             SELECT product_group FROM p_shop_variant
             WHERE id IN (SELECT value FROM json_each(?))
           )`,
      )
      .bind(locale, defaultLocale, ids),
  ]);

  const variants = new Map(
    ((variantResult?.results ?? []) as VariantRow[]).map((row) => [
      row.id,
      row,
    ]),
  );
  const prices = (priceResult?.results ?? []) as PriceRow[];
  const titles = (titleResult?.results ?? []) as TitleRow[];

  const priceOf = (variantId: string, wanted: Currency): number | null =>
    prices.find(
      (row) => row.variant_id === variantId && row.currency === wanted,
    )?.amount_minor ?? null;

  const nameOf = (productGroup: string): string | null => {
    const own = titles.filter((row) => row.translation_group === productGroup);
    return (
      own.find((row) => row.locale === locale)?.title ??
      own.find((row) => row.locale === defaultLocale)?.title ??
      null
    );
  };

  // One currency settles the whole order. If any line lacks a price in the
  // requested currency, every line falls back to the base currency: two
  // currencies inside one order produce a meaningless total, and charging a
  // dollar amount in euros is never acceptable.
  const shared = CURRENCIES.filter((candidate) =>
    lines.every((line) => priceOf(line.variantId, candidate) !== null),
  );
  const settleCurrency: Currency = shared.includes(currency)
    ? currency
    : BASE_CURRENCY;

  return {
    currency: settleCurrency,
    currencies: shared,
    lines: lines.map((line) => {
      const variant = variants.get(line.variantId);
      const name = variant === undefined ? null : nameOf(variant.product_group);
      const unitPriceMinor = priceOf(line.variantId, settleCurrency);
      const issue: CartIssue | null =
        variant === undefined || name === null
          ? { kind: 'unavailable', variantId: line.variantId }
          : (quantityIssue(variant, line.quantity) ??
            (unitPriceMinor === null
              ? { kind: 'no_price', variantId: line.variantId }
              : null));
      return {
        variantId: line.variantId,
        quantity: line.quantity,
        sku: variant?.sku ?? '',
        name,
        moq: variant?.moq ?? 1,
        unitPriceMinor,
        issue,
      };
    }),
  };
}

export async function priceCart(
  db: D1Database,
  input: {
    readonly lines: readonly CartLine[];
    readonly locale: string;
    readonly defaultLocale: string;
    readonly currency: Currency;
  },
): Promise<PricedCart> {
  if (input.lines.length === 0) {
    return { ok: false, issues: [{ kind: 'empty' }] };
  }
  const facts = await readCartFacts(db, input);

  const issues = facts.lines.flatMap((line) =>
    line.issue === null ? [] : [line.issue],
  );
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  const priced: PricedLine[] = facts.lines.map((line) => ({
    variantId: line.variantId,
    sku: line.sku,
    // Both are present: a line without either carries an issue.
    name: line.name ?? '',
    quantity: line.quantity,
    unitPriceMinor: line.unitPriceMinor ?? 0,
    lineTotalMinor: (line.unitPriceMinor ?? 0) * line.quantity,
  }));
  return {
    ok: true,
    currency: facts.currency,
    lines: priced,
    subtotalMinor: sumMinor(priced.map((line) => line.lineTotalMinor)),
  };
}
