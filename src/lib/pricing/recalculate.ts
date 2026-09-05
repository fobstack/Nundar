import { and, eq } from "drizzle-orm";
import {
  BASE_CURRENCY,
  CURRENCIES,
  type Currency,
  isCurrency,
} from "@/config/currency";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { convertPrice, needsRecalculation } from "@/lib/pricing";

/** Write a rate snapshot into exchange_rates, keeping one current row per currency pair */
export async function refreshExchangeRates(
  db: Db,
  rates: Record<string, number>,
  source = "ecb",
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  for (const [quote, rate] of Object.entries(rates)) {
    if (!isCurrency(quote) || quote === BASE_CURRENCY) {
      continue;
    }

    await db
      .insert(schema.exchangeRates)
      .values({
        baseCurrency: BASE_CURRENCY,
        quoteCurrency: quote,
        rate,
        fetchedAt: now,
        source,
      })
      .onConflictDoUpdate({
        target: [
          schema.exchangeRates.baseCurrency,
          schema.exchangeRates.quoteCurrency,
        ],
        set: { rate, fetchedAt: now, source },
      });
  }
}

export type RecalculationResult = {
  /** Price rows actually recomputed and written */
  updated: number;
  /** Rows left alone because the rate had not drifted past the threshold */
  skipped: number;
  /** Rows skipped because they carry a manual price */
  manual: number;
};

/**
 * Recompute automatic prices in every currency at the current rates.
 *
 * Three rules that do not bend:
 * 1. The base-currency price is entered by a human and is the source of truth.
 *    It is never rewritten.
 * 2. Rows with source = manual are never rewritten: a price chosen for a
 *    specific market outranks whatever the exchange rate says.
 * 3. Prices do not move until the rate has drifted past the threshold.
 *    Otherwise every static page would regenerate daily, and the constant drift
 *    between the price in the JSON-LD and the price at checkout triggers Google
 *    Merchant warnings.
 */
export async function recalculatePrices(db: Db): Promise<RecalculationResult> {
  const rateRows = await db
    .select()
    .from(schema.exchangeRates)
    .where(eq(schema.exchangeRates.baseCurrency, BASE_CURRENCY));

  const rateByCurrency = new Map<Currency, number>();
  for (const row of rateRows) {
    if (isCurrency(row.quoteCurrency)) {
      rateByCurrency.set(row.quoteCurrency, row.rate);
    }
  }

  if (rateByCurrency.size === 0) {
    return { updated: 0, skipped: 0, manual: 0 };
  }

  const basePrices = await db
    .select({
      variantId: schema.variantPrices.variantId,
      amountMinor: schema.variantPrices.amountMinor,
    })
    .from(schema.variantPrices)
    .where(eq(schema.variantPrices.currency, BASE_CURRENCY));

  const now = Math.floor(Date.now() / 1000);
  const result: RecalculationResult = { updated: 0, skipped: 0, manual: 0 };

  for (const base of basePrices) {
    for (const currency of CURRENCIES) {
      if (currency === BASE_CURRENCY) {
        continue;
      }

      const rate = rateByCurrency.get(currency);
      if (!rate) {
        continue;
      }

      const [existing] = await db
        .select()
        .from(schema.variantPrices)
        .where(
          and(
            eq(schema.variantPrices.variantId, base.variantId),
            eq(schema.variantPrices.currency, currency),
          ),
        )
        .limit(1);

      if (existing?.source === "manual") {
        result.manual += 1;
        continue;
      }

      if (
        existing &&
        !needsRecalculation({
          rateUsed: existing.rateUsed ?? 0,
          currentRate: rate,
        })
      ) {
        result.skipped += 1;
        continue;
      }

      const amountMinor = convertPrice({ baseMinor: base.amountMinor, rate });

      await db
        .insert(schema.variantPrices)
        .values({
          variantId: base.variantId,
          currency,
          amountMinor,
          source: "auto",
          rateUsed: rate,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            schema.variantPrices.variantId,
            schema.variantPrices.currency,
          ],
          set: { amountMinor, source: "auto", rateUsed: rate, updatedAt: now },
        });

      result.updated += 1;
    }
  }

  return result;
}
