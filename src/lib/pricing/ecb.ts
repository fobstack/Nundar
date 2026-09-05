/**
 * The European Central Bank's daily reference rates.
 *
 * Chosen over a commercial rates API for one decisive reason: it is free,
 * needs no API key, and is authoritative. Anyone who forks this project can run
 * it without signing up for a third-party service.
 *
 * Rates are quoted against EUR. This project's base currency is USD, so the
 * conversion crosses through EUR.
 *
 * The ECB does not publish on weekends or European holidays, in which case the
 * most recent working day's data comes back. That is harmless here, because
 * prices only move when drift exceeds a threshold.
 */
export const ECB_DAILY_URL =
  "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

export type EcbRates = {
  /** The ECB reference date, as YYYY-MM-DD */
  date: string;
  /** Quotes against EUR, including EUR itself at 1 */
  ratesFromEur: Record<string, number>;
};

/**
 * Parse the ECB's XML.
 * The Workers runtime has no DOMParser, and this document's structure is fixed
 * and simple enough that a regular expression is the honest tool here.
 */
export function parseEcbRates(xml: string): EcbRates {
  const ratesFromEur: Record<string, number> = { EUR: 1 };

  const ratePattern =
    /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g;
  for (const match of xml.matchAll(ratePattern)) {
    const value = Number(match[2]);
    if (Number.isFinite(value) && value > 0) {
      ratesFromEur[match[1]] = value;
    }
  }

  if (Object.keys(ratesFromEur).length <= 1) {
    throw new Error("ECB response contained no rates");
  }

  const dateMatch = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/);
  if (!dateMatch) {
    throw new Error("ECB response contained no reference date");
  }

  return { date: dateMatch[1], ratesFromEur };
}

/**
 * Re-base EUR-quoted rates onto any base currency.
 * The result reads as: one unit of base equals this many units of quote.
 */
export function ratesFromBase(
  ratesFromEur: Record<string, number>,
  base: string,
  quotes: readonly string[],
): Record<string, number> {
  const baseFromEur = ratesFromEur[base];
  if (!baseFromEur) {
    throw new Error(`ECB rates do not include the base currency ${base}`);
  }

  const result: Record<string, number> = {};
  for (const quote of quotes) {
    if (quote === base) {
      continue;
    }
    const quoteFromEur = ratesFromEur[quote];
    // A currency the source does not carry is skipped — never guessed, never zeroed
    if (quoteFromEur) {
      result[quote] = quoteFromEur / baseFromEur;
    }
  }

  return result;
}

/** Fetch and parse the current ECB rates */
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
