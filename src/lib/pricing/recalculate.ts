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

/** 把一份汇率快照写进 exchange_rates，同一对币种只保留最新一行 */
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
  /** 实际重算并落库的价格行数 */
  updated: number;
  /** 因汇率偏离未超阈值而保持不变的行数 */
  skipped: number;
  /** 因运营手动定价而跳过的行数 */
  manual: number;
};

/**
 * 按当前汇率重算各币种的自动价。
 *
 * 三条不可动摇的规则：
 * 1. 基准币种价格是运营手填的事实来源，永不改写
 * 2. source = manual 的行永不改写——运营针对该市场的定价优先于汇率
 * 3. 汇率偏离未超阈值时不动价——否则静态页要每日全量再生成，且 JSON-LD 里的
 *    价格与结算价频繁漂移会触发 Google Merchant 警告
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
