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
