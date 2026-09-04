import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import * as schema from "@/db/schema";
import { refreshExchangeRates, recalculatePrices } from "@/lib/pricing/recalculate";
import { seedDatabase } from "@/scripts/seed";

const THREADED = "seed-variant-dn50-threaded";

async function pricesFor(variantId: string) {
  return createDb(env.DB)
    .select()
    .from(schema.variantPrices)
    .where(eq(schema.variantPrices.variantId, variantId));
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM exchange_rates");
  await env.DB.exec("DELETE FROM variant_prices");
  await env.DB.exec("DELETE FROM product_variants");
  await env.DB.exec("DELETE FROM product_use_cases");
  await env.DB.exec("DELETE FROM product_features");
  await env.DB.exec("DELETE FROM product_translations");
  await env.DB.exec("DELETE FROM products");
  await seedDatabase(createDb(env.DB));
});

describe("refreshExchangeRates", () => {
  it("stores one row per quote currency", async () => {
    await refreshExchangeRates(createDb(env.DB), {
      EUR: 0.86,
      GBP: 0.739,
    });

    const rows = await createDb(env.DB).select().from(schema.exchangeRates);
    expect(rows.map((r) => r.quoteCurrency).sort()).toEqual(["EUR", "GBP"]);
    expect(rows.every((r) => r.baseCurrency === "USD")).toBe(true);
    expect(rows.every((r) => r.source === "ecb")).toBe(true);
  });

  it("overwrites the previous snapshot rather than accumulating rows", async () => {
    await refreshExchangeRates(createDb(env.DB), { EUR: 0.86 });
    await refreshExchangeRates(createDb(env.DB), { EUR: 0.9 });

    const rows = await createDb(env.DB).select().from(schema.exchangeRates);
    expect(rows).toHaveLength(1);
    expect(rows[0].rate).toBe(0.9);
  });
});

describe("recalculatePrices", () => {
  it("creates auto prices for currencies that had none", async () => {
    await refreshExchangeRates(createDb(env.DB), { EUR: 0.86, GBP: 0.739 });
    const result = await recalculatePrices(createDb(env.DB));

    const prices = await pricesFor(THREADED);
    const eur = prices.find((p) => p.currency === "EUR");

    // 9900 * 0.86 = 8514; * 1.03 缓冲 = 8769.42 → 8769 → .99 取整 → 8799
    expect(eur?.amountMinor).toBe(8799);
    expect(eur?.source).toBe("auto");
    expect(eur?.rateUsed).toBe(0.86);
    expect(result.updated).toBeGreaterThan(0);
  });

  it("leaves the base-currency price untouched", async () => {
    await refreshExchangeRates(createDb(env.DB), { EUR: 0.86 });
    await recalculatePrices(createDb(env.DB));

    const usd = (await pricesFor(THREADED)).find((p) => p.currency === "USD");
    expect(usd?.amountMinor).toBe(9900);
    expect(usd?.source).toBe("base");
  });

  it("never overwrites a manually set price", async () => {
    await env.DB.exec(
      `INSERT INTO variant_prices (variant_id, currency, amount_minor, source, updated_at) VALUES ('${THREADED}', 'EUR', 12345, 'manual', 1700000000)`,
    );
    await refreshExchangeRates(createDb(env.DB), { EUR: 0.86 });
    await recalculatePrices(createDb(env.DB));

    const eur = (await pricesFor(THREADED)).find((p) => p.currency === "EUR");
    expect(eur?.amountMinor).toBe(12345);
    expect(eur?.source).toBe("manual");
  });

  it("holds the price steady while the rate drifts under the threshold", async () => {
    await refreshExchangeRates(createDb(env.DB), { EUR: 0.86 });
    await recalculatePrices(createDb(env.DB));
    const before = (await pricesFor(THREADED)).find((p) => p.currency === "EUR");

    // 0.86 → 0.867 是 0.81% 偏离，低于 2% 阈值
    await refreshExchangeRates(createDb(env.DB), { EUR: 0.867 });
    const result = await recalculatePrices(createDb(env.DB));

    const after = (await pricesFor(THREADED)).find((p) => p.currency === "EUR");
    expect(after?.amountMinor).toBe(before?.amountMinor);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBeGreaterThan(0);
  });

  it("repricing kicks in once the rate drifts beyond the threshold", async () => {
    await refreshExchangeRates(createDb(env.DB), { EUR: 0.86 });
    await recalculatePrices(createDb(env.DB));

    // 0.86 → 0.95 是 10.5% 偏离
    await refreshExchangeRates(createDb(env.DB), { EUR: 0.95 });
    await recalculatePrices(createDb(env.DB));

    const eur = (await pricesFor(THREADED)).find((p) => p.currency === "EUR");
    expect(eur?.rateUsed).toBe(0.95);
    expect(eur?.amountMinor).toBeGreaterThan(8799);
  });

  it("does nothing when no rates have been fetched yet", async () => {
    const result = await recalculatePrices(createDb(env.DB));

    expect(result.updated).toBe(0);
    const prices = await pricesFor(THREADED);
    expect(prices.map((p) => p.currency)).toEqual(["USD"]);
  });
});
