import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import { listActiveProducts } from "@/lib/queries/products";
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

describe("listActiveProducts", () => {
  it("returns active products with the requested locale's name", async () => {
    const products = await listActiveProducts(createDb(env.DB), "de");

    expect(products.length).toBeGreaterThan(0);
    expect(products[0].name).toBe("Edelstahl-Kugelhahn DN50");
    expect(products[0].slug).toBe("stainless-ball-valve-dn50");
  });

  it("returns the lowest price in minor units for the requested currency", async () => {
    const products = await listActiveProducts(createDb(env.DB), "en", "USD");

    // Two SKUs priced at USD 99 and 168; the listing shows the lower one
    expect(products[0].fromPriceMinor).toBe(9900);
    expect(products[0].priceCurrency).toBe("USD");
  });

  it("falls back to the base currency and reports it, instead of mislabelling the amount", async () => {
    // The seed data is priced in USD only: asking for EUR must not display 9900
    // as EUR 99
    const products = await listActiveProducts(createDb(env.DB), "de", "EUR");

    expect(products[0].fromPriceMinor).toBe(9900);
    expect(products[0].priceCurrency).toBe("USD");
  });

  it("uses the requested currency once a price exists for it", async () => {
    await env.DB.exec(
      "INSERT INTO variant_prices (variant_id, currency, amount_minor, source, updated_at) VALUES ('seed-variant-dn50-threaded', 'EUR', 9199, 'auto', 1700000000)",
    );

    const products = await listActiveProducts(createDb(env.DB), "de", "EUR");

    expect(products[0].fromPriceMinor).toBe(9199);
    expect(products[0].priceCurrency).toBe("EUR");
  });

  it("collapses a multi-variant product into a single row", async () => {
    const products = await listActiveProducts(createDb(env.DB), "en");

    expect(products).toHaveLength(1);
  });

  it("excludes archived products", async () => {
    await env.DB.exec("UPDATE products SET status = 'archived'");

    const products = await listActiveProducts(createDb(env.DB), "en");
    expect(products).toHaveLength(0);
  });
});
