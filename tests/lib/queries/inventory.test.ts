import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import { getLiveInventory } from "@/lib/queries/inventory";
import { seedDatabase } from "@/scripts/seed";

beforeEach(async () => {
  await env.DB.exec("DELETE FROM variant_prices");
  await env.DB.exec("DELETE FROM product_variants");
  await env.DB.exec("DELETE FROM product_use_cases");
  await env.DB.exec("DELETE FROM product_features");
  await env.DB.exec("DELETE FROM product_translations");
  await env.DB.exec("DELETE FROM products");
  await seedDatabase(createDb(env.DB));
});

const THREADED = "seed-variant-dn50-threaded";

describe("getLiveInventory", () => {
  it("returns current stock and price for the requested variants", async () => {
    const items = await getLiveInventory(createDb(env.DB), [THREADED], "USD");

    expect(items).toHaveLength(1);
    expect(items[0].variantId).toBe(THREADED);
    expect(items[0].stock).toBe(120);
    expect(items[0].priceMinor).toBe(9900);
    expect(items[0].priceCurrency).toBe("USD");
  });

  it("reflects a stock change made after the page was generated", async () => {
    await env.DB.exec(
      `UPDATE product_variants SET stock = 3 WHERE id = '${THREADED}'`,
    );

    const items = await getLiveInventory(createDb(env.DB), [THREADED], "USD");
    expect(items[0].stock).toBe(3);
  });

  it("ignores unknown variant ids instead of failing the whole request", async () => {
    const items = await getLiveInventory(
      createDb(env.DB),
      [THREADED, "does-not-exist"],
      "USD",
    );

    expect(items.map((i) => i.variantId)).toEqual([THREADED]);
  });

  it("returns an empty list for an empty request", async () => {
    expect(await getLiveInventory(createDb(env.DB), [], "USD")).toEqual([]);
  });

  it("falls back to the base currency and reports it", async () => {
    const items = await getLiveInventory(createDb(env.DB), [THREADED], "EUR");

    expect(items[0].priceMinor).toBe(9900);
    expect(items[0].priceCurrency).toBe("USD");
  });
});
