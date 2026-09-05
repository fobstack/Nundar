import type { Currency } from "./currency";

export const LOCALES = ["en", "de", "fr", "es"] as const;

export type Locale = (typeof LOCALES)[number];

/** The default language, which also carries hreflang's x-default */
export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * The default currency for each language. Visitors can switch to any supported
 * currency, and the choice is remembered in a cookie.
 *
 * Never switched automatically by visitor IP. Crawlers fetch mostly from US
 * addresses, and redirecting them by IP leaves every other language version
 * unindexed.
 */
const LOCALE_DEFAULT_CURRENCY: Record<Locale, Currency> = {
  en: "USD",
  de: "EUR",
  fr: "EUR",
  es: "EUR",
};

export function defaultCurrencyForLocale(locale: Locale): Currency {
  return LOCALE_DEFAULT_CURRENCY[locale];
}
