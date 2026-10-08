/** The currencies the shop prices in. */
export const CURRENCIES = ['USD', 'EUR', 'GBP'] as const;

export type Currency = (typeof CURRENCIES)[number];

/**
 * The base currency: the only one priced by hand. Every other currency is
 * derived from it at an exchange rate, unless a price is overridden.
 */
export const BASE_CURRENCY: Currency = 'USD';

/** Decimal places in each currency's minor unit. */
export const CURRENCY_MINOR_UNITS: Readonly<Record<Currency, number>> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
};

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

/**
 * The currency a page in this language shows before the visitor chooses one:
 * USD for English, EUR for every other language.
 *
 * Decided by the language of the URL alone and never by the visitor's IP.
 * Crawlers fetch mostly from US addresses, and choosing by IP would show them
 * one currency on every language version.
 */
export function defaultCurrencyForLocale(locale: string): Currency {
  const language = locale.toLowerCase().split('-')[0];
  return language === 'en' ? 'USD' : 'EUR';
}

/**
 * The one currency a page, or a cart, is in.
 *
 * `shared` are the currencies everything on it has a price in. The one asked
 * for wins when it is among them — a page asks for its language's, a cart for
 * the one its buyer chose. Failing that the base currency, and failing that
 * whatever is shared at all: a part priced only in euros is shown in euros
 * rather than not at all. With nothing shared, the one asked for stands and
 * some of what is there has no price in it.
 *
 * One function, because a page and the cart it leads to must not disagree.
 */
export function settleCurrency(
  wanted: Currency,
  shared: readonly Currency[],
): Currency {
  if (shared.includes(wanted)) {
    return wanted;
  }
  if (shared.includes(BASE_CURRENCY)) {
    return BASE_CURRENCY;
  }
  return shared[0] ?? wanted;
}
