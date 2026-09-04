import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { LOCALES } from "@/config/locales";
import { createDb } from "@/db/client";
import * as schema from "@/db/schema";
import { seedDatabase } from "@/scripts/seed";

beforeEach(async () => {
  await env.DB.exec("DELETE FROM variant_prices");
  await env.DB.exec("DELETE FROM product_variants");
  await env.DB.exec("DELETE FROM product_use_cases");
  await env.DB.exec("DELETE FROM product_features");
  await env.DB.exec("DELETE FROM product_translations");
  await env.DB.exec("DELETE FROM products");
});

describe("seedDatabase", () => {
  it("creates at least one active product", async () => {
    const db = createDb(env.DB);
    await seedDatabase(db);

    const products = await db.select().from(schema.products);
    expect(products.length).toBeGreaterThan(0);
    expect(products.every((p) => p.status === "active")).toBe(true);
  });

  it("provides a translation in every shipped locale for every product", async () => {
    const db = createDb(env.DB);
    await seedDatabase(db);

    const products = await db.select().from(schema.products);
    for (const product of products) {
      const translations = await db
        .select()
        .from(schema.productTranslations)
        .where(eq(schema.productTranslations.productId, product.id));
      expect(translations.map((t) => t.locale).sort()).toEqual(
        [...LOCALES].sort(),
      );
    }
  });

  it("seeds features and use cases so the SEO layout has content to render", async () => {
    const db = createDb(env.DB);
    await seedDatabase(db);

    const features = await db.select().from(schema.productFeatures);
    const useCases = await db.select().from(schema.productUseCases);
    expect(features.length).toBeGreaterThan(0);
    expect(useCases.length).toBeGreaterThan(0);
  });

  it("gives every use case marked has_own_page a slug to build the URL from", async () => {
    const db = createDb(env.DB);
    await seedDatabase(db);

    const useCases = await db.select().from(schema.productUseCases);
    for (const useCase of useCases) {
      if (useCase.hasOwnPage === 1) {
        expect(useCase.scenarioSlug).toBeTruthy();
      }
    }
  });

  it("prices every variant in the base currency with source 'base'", async () => {
    const db = createDb(env.DB);
    await seedDatabase(db);

    const variants = await db.select().from(schema.productVariants);
    expect(variants.length).toBeGreaterThan(0);

    for (const variant of variants) {
      const prices = await db
        .select()
        .from(schema.variantPrices)
        .where(eq(schema.variantPrices.variantId, variant.id));
      const base = prices.find((p) => p.currency === "USD");
      expect(base).toBeDefined();
      expect(base!.source).toBe("base");
      expect(Number.isInteger(base!.amountMinor)).toBe(true);
    }
  });

  it("is idempotent so re-running it does not duplicate rows", async () => {
    const db = createDb(env.DB);
    await seedDatabase(db);
    const firstCount = (await db.select().from(schema.products)).length;

    await seedDatabase(db);
    const secondCount = (await db.select().from(schema.products)).length;

    expect(secondCount).toBe(firstCount);
  });
});
