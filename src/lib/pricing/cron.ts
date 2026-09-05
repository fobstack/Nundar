import { BASE_CURRENCY, CURRENCIES } from "@/config/currency";
import type { Db } from "@/db/client";
import { fetchEcbRates, ratesFromBase } from "./ecb";
import {
  recalculatePrices,
  refreshExchangeRates,
  type RecalculationResult,
} from "./recalculate";

export type CronOutcome =
  | { ok: true; date: string; result: RecalculationResult }
  | { ok: false; reason: string };

/**
 * The daily rates job: fetch from the ECB, store the snapshot, recompute the
 * automatic prices whose drift passed the threshold.
 *
 * A failed fetch does not throw. It returns a failure result and leaves the
 * previous snapshot in place, because not getting rates is routine — the ECB
 * skips weekends and holidays, and networks wobble. Neither should distort
 * prices or take the Worker down.
 */
export async function runExchangeRateCron(
  db: Db,
  fetchImpl: typeof fetch = fetch,
): Promise<CronOutcome> {
  try {
    const { date, ratesFromEur } = await fetchEcbRates(fetchImpl);
    const rates = ratesFromBase(ratesFromEur, BASE_CURRENCY, CURRENCIES);

    await refreshExchangeRates(db, rates);
    const result = await recalculatePrices(db);

    return { ok: true, date, result };
  } catch (error) {
    return {
      ok: false,
      // Keep the message alone, with no request context, so no PII reaches the logs
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
