/**
 * What a page shows of the shop: variants, prices and availability, ready to
 * print.
 *
 * This is the contract between the plugin and a theme. A template reads it as
 * `plugins.shop`, and every value in it is display-ready, because a plugin
 * cannot give a template a filter to format with. Keys are `snake_case`, as
 * in the rest of Mallok's view.
 *
 * On a product page:
 *
 *   currency      the currency `price` and `price_from` are in
 *   currencies    the currencies every priced variant has a price in
 *   price_from    the lowest unit price that can be ordered; '' when none
 *   prices_from   the same, once per currency
 *   variants[]    id, sku, label, moq, availability, lead_time, price, prices,
 *                 orderable
 *
 * On every page, priced or not:
 *
 *   cart_path     the cart page, in the page's language
 *   cart_action   where a form that changes the cart posts
 *
 * On a list or home page:
 *
 *   currency, currencies
 *   products      by content id: price_from, prices_from, availability
 *
 * Everything here is pure: rows in, a view out. The same rows give the same
 * view, which is what lets Mallok keep the page in its edge cache.
 */

import { type Availability, availabilityOf } from './availability.js';
import {
  BASE_CURRENCY,
  CURRENCIES,
  CURRENCY_MINOR_UNITS,
  type Currency,
  defaultCurrencyForLocale,
  isCurrency,
} from './currency.js';
import { formatMoney, fromMinor } from './money.js';

/** The columns of `p_shop_variant` a page needs. Never the stock itself. */
export interface StorefrontVariantRow {
  id: string;
  product_group: string;
  sku: string;
  option_values: string;
  moq: number;
  lead_time_min: number | null;
  lead_time_max: number | null;
  stock: number;
  stock_policy: string;
}

export interface StorefrontPriceRow {
  variant_id: string;
  currency: string;
  amount_minor: number;
}

/** One amount in one currency, as a page prints it. */
export interface DisplayPrice {
  readonly currency: Currency;
  readonly display: string;
}

export interface VariantView {
  readonly id: string;
  readonly sku: string;
  /** What distinguishes this variant, from its option values: `10 mm`. */
  readonly label: string;
  readonly moq: number;
  readonly availability: Availability;
  /** Business days, as `15–20` or `15`; '' when the variant states none. */
  readonly lead_time: string;
  /** The unit price in the page's currency; '' when there is none. */
  readonly price: string;
  /** The unit price in every currency the page offers. */
  readonly prices: readonly DisplayPrice[];
  /** Can go in the cart: it has a price and can be had. */
  readonly orderable: boolean;
}

export interface ProductView {
  readonly currency: Currency;
  readonly currencies: readonly Currency[];
  readonly price_from: string;
  readonly prices_from: readonly DisplayPrice[];
  readonly variants: readonly VariantView[];
}

export interface ListedProductView {
  readonly price_from: string;
  readonly prices_from: readonly DisplayPrice[];
  readonly availability: Availability;
}

export interface ListView {
  readonly currency: Currency;
  readonly currencies: readonly Currency[];
  readonly products: Readonly<Record<string, ListedProductView>>;
}

type Amounts = ReadonlyMap<Currency, number>;

/** Each variant's amounts by currency. A currency the shop no longer prices in is dropped. */
function amountsByVariant(
  prices: readonly StorefrontPriceRow[],
): Map<string, Map<Currency, number>> {
  const byVariant = new Map<string, Map<Currency, number>>();
  for (const row of prices) {
    if (!isCurrency(row.currency) || !Number.isInteger(row.amount_minor)) {
      continue;
    }
    const own = byVariant.get(row.variant_id) ?? new Map<Currency, number>();
    own.set(row.currency, row.amount_minor);
    byVariant.set(row.variant_id, own);
  }
  return byVariant;
}

/**
 * The currencies a page can show, and the one it shows first.
 *
 * A page is in one currency: a table with dollars in one row and euros in the
 * next cannot be compared, and a switch that changes some rows and not others
 * is worse. So a currency is offered only when every priced variant on the
 * page has a price in it. The language's own currency comes first when it is
 * among them — before the first exchange rates arrive it is not — and the
 * base currency otherwise. This is the rule `priceCart` settles an order by.
 *
 * A page with nothing priced offers no currency at all: there is nothing a
 * switch could change.
 */
export function currenciesFor(
  locale: string,
  priced: readonly Amounts[],
): { currency: Currency; currencies: Currency[] } {
  const shared =
    priced.length === 0
      ? []
      : CURRENCIES.filter((currency) =>
          priced.every((amounts) => amounts.has(currency)),
        );
  const preferred = defaultCurrencyForLocale(locale);
  const currency = shared.includes(preferred)
    ? preferred
    : shared.includes(BASE_CURRENCY)
      ? BASE_CURRENCY
      : (shared[0] ?? preferred);
  return { currency, currencies: shared };
}

/** `15–20`, or `15` when the two ends meet, or '' when either is missing. */
function leadTime(row: StorefrontVariantRow): string {
  const { lead_time_min: min, lead_time_max: max } = row;
  if (
    min === null ||
    max === null ||
    !Number.isInteger(min) ||
    !Number.isInteger(max) ||
    min < 0 ||
    max < min
  ) {
    return '';
  }
  return min === max ? String(min) : `${min}–${max}`;
}

/** The option values, in the order they were entered: `M5 / 10 mm`. */
function labelOf(optionValues: string): string {
  try {
    const parsed: unknown = JSON.parse(optionValues);
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return '';
    }
    return Object.values(parsed)
      .filter((value): value is string | number =>
        typeof value === 'string'
          ? value.trim() !== ''
          : Number.isFinite(value),
      )
      .map(String)
      .join(' / ');
  } catch {
    return '';
  }
}

function display(
  amounts: Amounts | undefined,
  currencies: readonly Currency[],
  locale: string,
): DisplayPrice[] {
  if (amounts === undefined) {
    return [];
  }
  return currencies.flatMap((currency) => {
    const minor = amounts.get(currency);
    return minor === undefined
      ? []
      : [{ currency, display: formatMoney(minor, currency, locale) }];
  });
}

/**
 * The lowest price a buyer can act on: among the variants that can be
 * ordered, or among all of them when none can, so that a product which is
 * out of stock still says what it costs.
 */
function lowest(
  variants: readonly StorefrontVariantRow[],
  amounts: ReadonlyMap<string, Amounts>,
  currency: Currency,
): StorefrontVariantRow | undefined {
  const priced = variants.filter(
    (variant) => amounts.get(variant.id)?.has(currency) === true,
  );
  const orderable = priced.filter(
    (variant) => availabilityOf(variant) !== 'out_of_stock',
  );
  const pool = orderable.length > 0 ? orderable : priced;
  let best: StorefrontVariantRow | undefined;
  for (const variant of pool) {
    const own = amounts.get(variant.id)?.get(currency) ?? 0;
    const least =
      best === undefined
        ? Infinity
        : (amounts.get(best.id)?.get(currency) ?? 0);
    if (own < least) {
      best = variant;
    }
  }
  return best;
}

/** One state for a whole product: the best any of its variants offers. */
function availabilityOfProduct(
  variants: readonly StorefrontVariantRow[],
): Availability {
  const states = new Set(variants.map((variant) => availabilityOf(variant)));
  if (states.has('in_stock')) {
    return 'in_stock';
  }
  return states.has('made_to_order') ? 'made_to_order' : 'out_of_stock';
}

/**
 * A product page's view of its variants; undefined when it has none.
 *
 * `variants` are the product's active variants, in the order to show them.
 */
export function productView(
  variants: readonly StorefrontVariantRow[],
  prices: readonly StorefrontPriceRow[],
  locale: string,
): ProductView | undefined {
  if (variants.length === 0) {
    return undefined;
  }
  const amounts = amountsByVariant(prices);
  const priced = variants.flatMap((variant) => {
    const own = amounts.get(variant.id);
    return own === undefined ? [] : [own];
  });
  const { currency, currencies } = currenciesFor(locale, priced);
  const cheapest = lowest(variants, amounts, currency);
  const pricesFrom =
    cheapest === undefined
      ? []
      : display(amounts.get(cheapest.id), currencies, locale);

  return {
    currency,
    currencies,
    price_from:
      pricesFrom.find((price) => price.currency === currency)?.display ?? '',
    prices_from: pricesFrom,
    variants: variants.map((variant) => {
      const own = display(amounts.get(variant.id), currencies, locale);
      const price =
        own.find((entry) => entry.currency === currency)?.display ?? '';
      const availability = availabilityOf(variant);
      return {
        id: variant.id,
        sku: variant.sku,
        label: labelOf(variant.option_values),
        moq: variant.moq,
        availability,
        lead_time: leadTime(variant),
        price,
        prices: own,
        // A cart line without a price cannot be priced, and one that is out
        // of stock would be refused: neither is offered a form.
        orderable: price !== '' && availability !== 'out_of_stock',
      };
    }),
  };
}

/**
 * A list page's view: for each product shown that has variants, what it
 * costs from and whether it can be had. Undefined when none has any.
 *
 * `items` are the products on the page, by content id and translation group.
 */
export function listView(
  items: readonly { readonly id: string; readonly translationGroup: string }[],
  variants: readonly StorefrontVariantRow[],
  prices: readonly StorefrontPriceRow[],
  locale: string,
): ListView | undefined {
  const amounts = amountsByVariant(prices);
  const byGroup = new Map<string, StorefrontVariantRow[]>();
  for (const variant of variants) {
    const own = byGroup.get(variant.product_group) ?? [];
    own.push(variant);
    byGroup.set(variant.product_group, own);
  }

  const listed = items.flatMap((item) => {
    const own = byGroup.get(item.translationGroup);
    return own === undefined ? [] : [{ id: item.id, variants: own }];
  });
  if (listed.length === 0) {
    return undefined;
  }

  // One currency for the whole list, by the rule a product page follows.
  const priced = listed.flatMap((product) =>
    product.variants.flatMap((variant) => {
      const own = amounts.get(variant.id);
      return own === undefined ? [] : [own];
    }),
  );
  const { currency, currencies } = currenciesFor(locale, priced);

  const products: Record<string, ListedProductView> = {};
  for (const product of listed) {
    const cheapest = lowest(product.variants, amounts, currency);
    const pricesFrom =
      cheapest === undefined
        ? []
        : display(amounts.get(cheapest.id), currencies, locale);
    products[product.id] = {
      price_from:
        pricesFrom.find((price) => price.currency === currency)?.display ?? '',
      prices_from: pricesFrom,
      availability: availabilityOfProduct(product.variants),
    };
  }
  return { currency, currencies, products };
}

/**
 * What Google documents for `Offer.availability` has no value for an item
 * that is made when it is ordered (product structured data, read 2026-10-08;
 * schema.org itself has `MadeToOrder`). `BackOrder` is the documented value
 * that says the same thing to a buyer: it can be ordered now and ships later.
 */
const SCHEMA_AVAILABILITY: Readonly<Record<Availability, string>> = {
  in_stock: 'https://schema.org/InStock',
  made_to_order: 'https://schema.org/BackOrder',
  out_of_stock: 'https://schema.org/OutOfStock',
};

/** schema.org wants a decimal in major units: `99.00`, never `9900`. */
function decimal(minor: number, currency: Currency): string {
  return fromMinor(minor, currency).toFixed(CURRENCY_MINOR_UNITS[currency]);
}

/**
 * The `offers` of a product page's structured data, or undefined when the
 * page shows no price.
 *
 * It says what the page says and nothing more: the same variants, the price
 * each row prints in the page's currency, the availability each row prints.
 * One priced variant is an `Offer`; several are an `AggregateOffer` holding
 * them, which is the form Google reads a price range from.
 */
export function offersFor(
  variants: readonly StorefrontVariantRow[],
  prices: readonly StorefrontPriceRow[],
  locale: string,
): Readonly<Record<string, unknown>> | undefined {
  const amounts = amountsByVariant(prices);
  const priced = variants.flatMap((variant) => {
    const own = amounts.get(variant.id);
    return own === undefined ? [] : [own];
  });
  const { currency } = currenciesFor(locale, priced);

  const offers = variants.flatMap((variant) => {
    const minor = amounts.get(variant.id)?.get(currency);
    if (minor === undefined) {
      return [];
    }
    const { lead_time_min: min, lead_time_max: max } = variant;
    return [
      {
        minor,
        offer: {
          '@type': 'Offer',
          sku: variant.sku,
          price: decimal(minor, currency),
          priceCurrency: currency,
          availability: SCHEMA_AVAILABILITY[availabilityOf(variant)],
          ...(variant.moq > 1
            ? {
                eligibleQuantity: {
                  '@type': 'QuantitativeValue',
                  minValue: variant.moq,
                },
              }
            : {}),
          ...(leadTime(variant) !== '' && min !== null && max !== null
            ? {
                deliveryLeadTime: {
                  '@type': 'QuantitativeValue',
                  minValue: min,
                  maxValue: max,
                  unitCode: 'DAY',
                },
              }
            : {}),
        },
      },
    ];
  });

  const [only] = offers;
  if (only === undefined) {
    return undefined;
  }
  if (offers.length === 1) {
    return only.offer;
  }
  const amountsShown = offers.map((entry) => entry.minor);
  return {
    '@type': 'AggregateOffer',
    priceCurrency: currency,
    lowPrice: decimal(Math.min(...amountsShown), currency),
    highPrice: decimal(Math.max(...amountsShown), currency),
    offerCount: offers.length,
    offers: offers.map((entry) => entry.offer),
  };
}
