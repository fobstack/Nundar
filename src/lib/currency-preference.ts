import { BASE_CURRENCY, isCurrency, type Currency } from "@/config/currency";

/**
 * Currency preference, stored in a cookie.
 *
 * Language is determined solely by the URL prefix; currency is deliberately
 * decoupled from it, because buyers reading the same language may want
 * different currencies.
 *
 * Never switch automatically by IP. Crawlers mostly fetch from US addresses,
 * so rewriting content by IP would leave the other versions unindexed.
 */
export const CURRENCY_COOKIE = "nundar_currency";

export const CURRENCY_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Parse the preference out of a cookie string; anything unrecognised is ignored */
export function parseCurrencyCookie(
  raw: string | undefined | null,
  fallback: Currency = BASE_CURRENCY,
): Currency {
  if (!raw) {
    return fallback;
  }
  return isCurrency(raw) ? raw : fallback;
}

/** Read the preference in the browser; returns null during SSR so callers fall back */
export function readCurrencyCookieFromDocument(): Currency | null {
  if (typeof document === "undefined") {
    return null;
  }

  const match = document.cookie.match(
    new RegExp(`(?:^|; )${CURRENCY_COOKIE}=([^;]*)`),
  );
  const value = match ? decodeURIComponent(match[1]) : null;

  return value && isCurrency(value) ? value : null;
}
