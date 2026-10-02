/**
 * The European Central Bank's daily reference rates.
 *
 * Chosen over a commercial rates API for one decisive reason: it is free,
 * needs no API key and is authoritative, so anyone who runs this shop can do
 * so without signing up for a third-party service.
 *
 * The rates are quoted against EUR. The shop's base currency is USD, so a
 * conversion crosses through EUR.
 *
 * The ECB does not publish on weekends or on European holidays; the most
 * recent working day's figures come back instead. That is harmless here,
 * because a price moves only when the drift passes a threshold.
 */

export const ECB_DAILY_URL =
  'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

export interface EcbRates {
  /** The ECB reference date, as YYYY-MM-DD. */
  readonly date: string;
  /** Quotes against EUR, including EUR itself at 1. */
  readonly ratesFromEur: Readonly<Record<string, number>>;
}

/**
 * Parses the ECB's XML.
 *
 * The Workers runtime has no `DOMParser`, and this document's structure is
 * fixed and simple enough that a regular expression is the honest tool.
 */
export function parseEcbRates(xml: string): EcbRates {
  const ratesFromEur: Record<string, number> = { EUR: 1 };

  const ratePattern =
    /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g;
  for (const match of xml.matchAll(ratePattern)) {
    const currency = match[1];
    const value = Number(match[2]);
    if (currency !== undefined && Number.isFinite(value) && value > 0) {
      ratesFromEur[currency] = value;
    }
  }

  if (Object.keys(ratesFromEur).length <= 1) {
    throw new Error('ECB response contained no rates');
  }

  const date = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
  if (date === undefined) {
    throw new Error('ECB response contained no reference date');
  }

  return { date, ratesFromEur };
}

/**
 * Re-bases EUR-quoted rates onto another base currency.
 *
 * The result reads as: one unit of `base` equals this many units of the quote.
 */
export function ratesFromBase(
  ratesFromEur: Readonly<Record<string, number>>,
  base: string,
  quotes: readonly string[],
): Record<string, number> {
  const baseFromEur = ratesFromEur[base];
  if (baseFromEur === undefined || !(baseFromEur > 0)) {
    throw new Error(`ECB rates do not include the base currency ${base}`);
  }

  const result: Record<string, number> = {};
  for (const quote of quotes) {
    if (quote === base) {
      continue;
    }
    const quoteFromEur = ratesFromEur[quote];
    // A currency the source does not carry is skipped — never guessed, never
    // zeroed.
    if (quoteFromEur !== undefined && quoteFromEur > 0) {
      result[quote] = quoteFromEur / baseFromEur;
    }
  }
  return result;
}

/** Fetches and parses the current ECB rates. */
export async function fetchEcbRates(
  fetchImpl: typeof fetch = fetch,
): Promise<EcbRates> {
  const response = await fetchImpl(ECB_DAILY_URL);
  if (!response.ok) {
    throw new Error(
      `ECB request failed with status ${response.status} ${response.statusText}`,
    );
  }
  return parseEcbRates(await response.text());
}
