/**
 * The admin's form for shipping zones: a `records` panel, which Mallok draws
 * and never writes itself. A zone has a name, the countries in it, and a rate
 * in each currency it can be paid in.
 *
 * A country is in one zone at most. The key of `p_shop_shipping_country`
 * says so; a save that would put one in a second zone is answered with the
 * zone it is in already, read from the table — first before the write, and
 * again if the write still met one, since two saves can cross.
 */

import type {
  MoneyValue,
  PluginContext,
  PluginRecordInput,
} from 'mallok/worker';
import { type Currency, isCurrency } from './currency.js';
import { isKnownCountry } from './shipping.js';

type SaveResult =
  | { readonly id: string }
  | { readonly errors: Readonly<Record<string, string>> };

interface RateRow {
  readonly price: MoneyValue | null;
  readonly free_over: MoneyValue | null;
}

export async function loadShippingZone(
  id: string,
  ctx: PluginContext,
): Promise<Record<string, unknown> | null> {
  const [zoneResult, countryResult, rateResult] = await ctx.db.batch<
    Record<string, unknown>
  >([
    ctx.db
      .prepare('SELECT name, sort_order FROM p_shop_shipping_zone WHERE id = ?')
      .bind(id),
    ctx.db
      .prepare(
        'SELECT country FROM p_shop_shipping_country WHERE zone_id = ? ORDER BY country',
      )
      .bind(id),
    ctx.db
      .prepare(
        `SELECT currency, amount_minor, free_over_minor FROM p_shop_shipping_rate
         WHERE zone_id = ? ORDER BY currency`,
      )
      .bind(id),
  ]);
  const zone = (zoneResult?.results ?? [])[0];
  if (zone === undefined) {
    return null;
  }
  return {
    name: zone.name,
    countries: (countryResult?.results ?? []).map((row) => row.country),
    rates: (rateResult?.results ?? []).map((row) => ({
      price: { amount: row.amount_minor, currency: row.currency },
      free_over:
        row.free_over_minor === null
          ? null
          : { amount: row.free_over_minor, currency: row.currency },
    })),
    sort_order: zone.sort_order,
  };
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** The values of a zone as the form sent them, or what is wrong with them. */
function check(values: Readonly<Record<string, unknown>>):
  | {
      readonly ok: true;
      readonly name: string;
      readonly countries: string[];
      readonly rates: {
        currency: Currency;
        amountMinor: number;
        freeOverMinor: number | null;
      }[];
      readonly sortOrder: number;
    }
  | { readonly ok: false; readonly errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = textOf(values.name);
  if (name === '' || name.length > 100) {
    errors.name = 'A zone needs a name of up to 100 characters.';
  }

  const listed = Array.isArray(values.countries) ? values.countries : [];
  const countries = [
    ...new Set(listed.map((entry) => textOf(entry).toUpperCase())),
  ];
  const unknown = countries.filter((code) => !isKnownCountry(code));
  if (countries.length === 0) {
    errors.countries = 'A zone needs at least one country.';
  } else if (unknown.length > 0) {
    errors.countries = `Not a country code: ${unknown.join(', ')}. Use the two-letter ISO code, such as DE.`;
  }

  const rows = (Array.isArray(values.rates) ? values.rates : []) as RateRow[];
  const rates: {
    currency: Currency;
    amountMinor: number;
    freeOverMinor: number | null;
  }[] = [];
  rows.forEach((row, index) => {
    const price = row.price;
    if (price === null || !isCurrency(price.currency)) {
      errors[`rates.${index}.price`] = 'Each rate needs an amount.';
      return;
    }
    if (rates.some((rate) => rate.currency === price.currency)) {
      errors[`rates.${index}.price`] =
        `There is a rate in ${price.currency} already.`;
      return;
    }
    const freeOver = row.free_over;
    if (freeOver !== null && freeOver.currency !== price.currency) {
      errors[`rates.${index}.free_over`] =
        `The amount past which shipping is free has to be in ${price.currency}, like the rate.`;
      return;
    }
    if (freeOver !== null && freeOver.amount <= 0) {
      errors[`rates.${index}.free_over`] =
        'Leave it empty for no free shipping, or give an amount above nothing.';
      return;
    }
    rates.push({
      currency: price.currency,
      amountMinor: price.amount,
      freeOverMinor: freeOver === null ? null : freeOver.amount,
    });
  });
  if (rows.length === 0) {
    errors.rates = 'A zone needs a rate in at least one currency.';
  }

  const sortOrder =
    typeof values.sort_order === 'number' && Number.isInteger(values.sort_order)
      ? values.sort_order
      : 0;

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, name, countries, rates, sortOrder };
}

/** The countries of a list that are in another zone, with that zone's name. */
async function takenElsewhere(
  db: D1Database,
  zoneId: string,
  countries: readonly string[],
): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT c.country AS country, z.name AS zone
       FROM p_shop_shipping_country AS c
       JOIN p_shop_shipping_zone AS z ON z.id = c.zone_id
       WHERE c.zone_id <> ?
         AND c.country IN (SELECT value FROM json_each(?))
       ORDER BY c.country`,
    )
    .bind(zoneId, JSON.stringify(countries))
    .all<{ country: string; zone: string }>();
  return results.map((row) => `${row.country} (${row.zone})`);
}

export async function saveShippingZone(
  record: PluginRecordInput,
  ctx: PluginContext,
  now: Date = new Date(),
): Promise<SaveResult> {
  const checked = check(record.values);
  if (!checked.ok) {
    return { errors: checked.errors };
  }
  const id = record.id ?? crypto.randomUUID();
  const elsewhere = await takenElsewhere(ctx.db, id, checked.countries);
  if (elsewhere.length > 0) {
    return {
      errors: {
        countries: `Already in another zone: ${elsewhere.join(', ')}. A country is in one zone at most.`,
      },
    };
  }

  const nowIso = now.toISOString();
  const countries = JSON.stringify(checked.countries);
  try {
    await ctx.db.batch([
      ctx.db
        .prepare(
          `INSERT INTO p_shop_shipping_zone (id, name, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET
             name = excluded.name, sort_order = excluded.sort_order,
             updated_at = excluded.updated_at`,
        )
        .bind(id, checked.name, checked.sortOrder, nowIso, nowIso),
      ctx.db
        .prepare('DELETE FROM p_shop_shipping_country WHERE zone_id = ?')
        .bind(id),
      ctx.db
        .prepare(
          `INSERT INTO p_shop_shipping_country (country, zone_id)
           SELECT value, ? FROM json_each(?)`,
        )
        .bind(id, countries),
      ctx.db
        .prepare('DELETE FROM p_shop_shipping_rate WHERE zone_id = ?')
        .bind(id),
      ctx.db
        .prepare(
          `INSERT INTO p_shop_shipping_rate
             (zone_id, currency, amount_minor, free_over_minor)
           SELECT ?, json_extract(value, '$.currency'),
                  json_extract(value, '$.amountMinor'),
                  json_extract(value, '$.freeOverMinor')
           FROM json_each(?)`,
        )
        .bind(id, JSON.stringify(checked.rates)),
    ]);
  } catch (error) {
    // Another save took a country between this one's reading and its write.
    // Which one is read again, rather than guessed from the error's text.
    const crossed = await takenElsewhere(ctx.db, id, checked.countries);
    if (crossed.length > 0) {
      return {
        errors: {
          countries: `Already in another zone: ${crossed.join(', ')}. A country is in one zone at most.`,
        },
      };
    }
    throw error;
  }
  return { id };
}

/**
 * Removes a zone, its countries and its rates. An order shipped to it keeps
 * the zone's name, which it was given as a snapshot.
 */
export async function removeShippingZone(
  id: string,
  ctx: PluginContext,
): Promise<void> {
  await ctx.db.batch([
    ctx.db
      .prepare('DELETE FROM p_shop_shipping_rate WHERE zone_id = ?')
      .bind(id),
    ctx.db
      .prepare('DELETE FROM p_shop_shipping_country WHERE zone_id = ?')
      .bind(id),
    ctx.db.prepare('DELETE FROM p_shop_shipping_zone WHERE id = ?').bind(id),
  ]);
}
