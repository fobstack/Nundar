/**
 * What shipping an order costs.
 *
 * A seller groups the countries they ship to into zones, and gives each zone
 * a fixed rate in each currency, and if they like an amount past which it
 * ships free. A country in no zone is one the shop does not ship to, and
 * cannot be checked out to.
 *
 * Every product weighs something (`weight_grams`), so a rate by weight can be
 * added later without new data; a fixed rate per zone is what was decided
 * (design §20).
 */

import { CURRENCIES, type Currency, isCurrency } from './currency.js';

/** A zone's rate in one currency. */
export interface ShippingRate {
  readonly zoneId: string;
  readonly zoneName: string;
  readonly currency: Currency;
  readonly amountMinor: number;
  /** Goods coming to this much or more ship free. Null when nothing does. */
  readonly freeOverMinor: number | null;
}

export function isCountryCode(value: string): boolean {
  return /^[A-Z]{2}$/.test(value);
}

/**
 * A country's name in a language, for a page or an email. The code itself
 * when the runtime does not know the region: a name is a convenience, and a
 * code is never wrong.
 */
export function countryName(code: string, locale: string): string {
  try {
    return (
      new Intl.DisplayNames([locale], { type: 'region', fallback: 'code' }).of(
        code,
      ) ?? code
    );
  } catch {
    return code;
  }
}

/**
 * Whether the runtime knows a code as a region. `Intl.DisplayNames` answers
 * an unknown code with the code itself, which is how one is told apart.
 */
export function isKnownCountry(code: string): boolean {
  if (!isCountryCode(code)) {
    return false;
  }
  try {
    return (
      new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' }).of(
        code,
      ) !== undefined
    );
  } catch {
    return false;
  }
}

/** The rate for a country in a currency: one row, or none. */
export function shippingRateStatement(
  db: D1Database,
  country: string,
  currency: Currency,
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT z.id AS zone_id, z.name AS zone_name, r.currency AS currency,
              r.amount_minor AS amount_minor,
              r.free_over_minor AS free_over_minor
       FROM p_shop_shipping_country AS c
       JOIN p_shop_shipping_zone AS z ON z.id = c.zone_id
       JOIN p_shop_shipping_rate AS r ON r.zone_id = z.id AND r.currency = ?
       WHERE c.country = ?`,
    )
    .bind(currency, country);
}

export function rateOf(row: unknown): ShippingRate | null {
  if (row === null || typeof row !== 'object') {
    return null;
  }
  const value = row as Record<string, unknown>;
  const currency = String(value.currency ?? '');
  if (
    typeof value.zone_id !== 'string' ||
    typeof value.zone_name !== 'string' ||
    !isCurrency(currency) ||
    typeof value.amount_minor !== 'number'
  ) {
    return null;
  }
  return {
    zoneId: value.zone_id,
    zoneName: value.zone_name,
    currency,
    amountMinor: value.amount_minor,
    freeOverMinor:
      typeof value.free_over_minor === 'number' ? value.free_over_minor : null,
  };
}

/** The countries the shop ships to, with the currencies each can be paid in. */
export function shippingCountriesStatement(
  db: D1Database,
): D1PreparedStatement {
  return db.prepare(
    `SELECT c.country AS country,
            (SELECT json_group_array(r.currency) FROM p_shop_shipping_rate AS r
             WHERE r.zone_id = c.zone_id) AS currencies
     FROM p_shop_shipping_country AS c
     ORDER BY c.country`,
  );
}

export interface ShippingCountry {
  readonly code: string;
  readonly currencies: readonly Currency[];
}

export function shippingCountriesOf(
  rows: readonly unknown[],
): ShippingCountry[] {
  return rows.flatMap((row) => {
    const value = row as { country?: unknown; currencies?: unknown };
    if (typeof value.country !== 'string') {
      return [];
    }
    let currencies: unknown = [];
    try {
      currencies = JSON.parse(String(value.currencies ?? '[]'));
    } catch {
      currencies = [];
    }
    return [
      {
        code: value.country,
        currencies: CURRENCIES.filter(
          (currency) =>
            Array.isArray(currencies) && currencies.includes(currency),
        ),
      },
    ];
  });
}

/**
 * What shipping costs for goods of a value, at a rate. Free past the rate's
 * threshold, which compares the goods alone: shipping does not count towards
 * its own waiver, and neither would a tax.
 */
export function shippingCostMinor(
  rate: Pick<ShippingRate, 'amountMinor' | 'freeOverMinor'>,
  goodsMinor: number,
): number {
  return rate.freeOverMinor !== null && goodsMinor >= rate.freeOverMinor
    ? 0
    : rate.amountMinor;
}
