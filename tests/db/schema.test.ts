import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";

function db() {
  return drizzle(env.DB, { schema });
}

const now = () => Math.floor(Date.now() / 1000);

beforeEach(async () => {
  // Truncation order follows the foreign keys: children before parents
  await env.DB.exec("DELETE FROM variant_prices");
  await env.DB.exec("DELETE FROM product_variants");
  await env.DB.exec("DELETE FROM product_use_cases");
  await env.DB.exec("DELETE FROM product_features");
  await env.DB.exec("DELETE FROM product_translations");
  await env.DB.exec("DELETE FROM products");
});

describe("product schema", () => {
  it("stores a product with per-locale translations", async () => {
    const d = db();
    await d.insert(schema.products).values({
      id: "p1",
      slug: "ball-valve-dn50",
      status: "active",
      createdAt: now(),
      updatedAt: now(),
    });
    await d.insert(schema.productTranslations).values([
      { productId: "p1", locale: "en", name: "Ball Valve DN50" },
      { productId: "p1", locale: "de", name: "Kugelhahn DN50" },
    ]);

    const rows = await d
      .select()
      .from(schema.productTranslations)
      .where(eq(schema.productTranslations.productId, "p1"));

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.locale).sort()).toEqual(["de", "en"]);
  });

  it("rejects a duplicate slug", async () => {
    const d = db();
    const base = { status: "active", createdAt: now(), updatedAt: now() };
    await d.insert(schema.products).values({ id: "p1", slug: "dup", ...base });

    await expect(
      d.insert(schema.products).values({ id: "p2", slug: "dup", ...base }),
    ).rejects.toThrow();
  });

  it("defaults moq to 1 so ordinary products need no configuration", async () => {
    const d = db();
    await d.insert(schema.products).values({
      id: "p1",
      slug: "s",
      status: "active",
      createdAt: now(),
      updatedAt: now(),
    });
    await d.insert(schema.productVariants).values({
      id: "v1",
      productId: "p1",
      sku: "SKU-1",
      stock: 10,
      optionValues: '{"size":"M"}',
    });

    const [variant] = await d
      .select()
      .from(schema.productVariants)
      .where(eq(schema.productVariants.id, "v1"));

    expect(variant.moq).toBe(1);
  });

  it("keeps one price row per variant and currency", async () => {
    const d = db();
    await d.insert(schema.products).values({
      id: "p1",
      slug: "s",
      status: "active",
      createdAt: now(),
      updatedAt: now(),
    });
    await d.insert(schema.productVariants).values({
      id: "v1",
      productId: "p1",
      sku: "SKU-1",
      stock: 10,
      optionValues: "{}",
    });
    await d.insert(schema.variantPrices).values({
      variantId: "v1",
      currency: "USD",
      amountMinor: 9900,
      source: "base",
      updatedAt: now(),
    });

    await expect(
      d.insert(schema.variantPrices).values({
        variantId: "v1",
        currency: "USD",
        amountMinor: 8800,
        source: "manual",
        updatedAt: now(),
      }),
    ).rejects.toThrow();
  });
});
