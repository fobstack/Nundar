import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import * as schema from "@/db/schema";
import {
  clearManualPrice,
  createProduct,
  setProductStatus,
  saveProductTranslation,
  setManualPrice,
  updateBasePrice,
  updateUseCasePage,
  updateVariantLogistics,
} from "@/lib/admin/mutations";
import { seedDatabase } from "@/scripts/seed";

const PRODUCT_ID = "seed-ball-valve-dn50";
const THREADED = "seed-variant-dn50-threaded";

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

async function translation(locale: string) {
  const [row] = await createDb(env.DB)
    .select()
    .from(schema.productTranslations)
    .where(
      and(
        eq(schema.productTranslations.productId, PRODUCT_ID),
        eq(schema.productTranslations.locale, locale),
      ),
    );
  return row;
}

async function price(currency: string) {
  const [row] = await createDb(env.DB)
    .select()
    .from(schema.variantPrices)
    .where(
      and(
        eq(schema.variantPrices.variantId, THREADED),
        eq(schema.variantPrices.currency, currency),
      ),
    );
  return row;
}

describe("saveProductTranslation", () => {
  it("updates the translation for one locale only", async () => {
    await saveProductTranslation(createDb(env.DB), PRODUCT_ID, "de", {
      name: "Neuer Name",
      summary: "Neue Zusammenfassung",
      description: "Beschreibung",
      seoTitle: "SEO Titel",
      seoDescription: "SEO Beschreibung",
    });

    expect((await translation("de")).name).toBe("Neuer Name");
    expect((await translation("en")).name).toBe("Stainless Steel Ball Valve DN50");
  });

  it("creates the row when that locale had no translation yet", async () => {
    await env.DB.exec(
      `DELETE FROM product_translations WHERE product_id = '${PRODUCT_ID}' AND locale = 'es'`,
    );

    await saveProductTranslation(createDb(env.DB), PRODUCT_ID, "es", {
      name: "Nombre nuevo",
      summary: null,
      description: null,
      seoTitle: null,
      seoDescription: null,
    });

    expect((await translation("es")).name).toBe("Nombre nuevo");
  });

  it("rejects an empty name rather than publishing a nameless product", async () => {
    await expect(
      saveProductTranslation(createDb(env.DB), PRODUCT_ID, "de", {
        name: "   ",
        summary: null,
        description: null,
        seoTitle: null,
        seoDescription: null,
      }),
    ).rejects.toThrow(/name/i);
  });

  it("bumps the product's updated_at so sitemap lastModified moves", async () => {
    await env.DB.exec(`UPDATE products SET updated_at = 1 WHERE id = '${PRODUCT_ID}'`);

    await saveProductTranslation(createDb(env.DB), PRODUCT_ID, "de", {
      name: "Neuer Name",
      summary: null,
      description: null,
      seoTitle: null,
      seoDescription: null,
    });

    const [product] = await createDb(env.DB)
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, PRODUCT_ID));
    expect(product.updatedAt).toBeGreaterThan(1);
  });
});

describe("updateBasePrice", () => {
  it("writes the base price in minor units", async () => {
    await updateBasePrice(createDb(env.DB), THREADED, 12550);

    const usd = await price("USD");
    expect(usd.amountMinor).toBe(12550);
    expect(usd.source).toBe("base");
  });

  it("rejects a negative price", async () => {
    await expect(updateBasePrice(createDb(env.DB), THREADED, -1)).rejects.toThrow(
      /price/i,
    );
  });

  it("invalidates auto prices so they are recomputed from the new base", async () => {
    await env.DB.exec(
      `INSERT INTO variant_prices (variant_id, currency, amount_minor, source, rate_used, updated_at) VALUES ('${THREADED}', 'EUR', 8799, 'auto', 0.86, 1700000000)`,
    );

    await updateBasePrice(createDb(env.DB), THREADED, 20000);

    // Once the base price changes the old auto prices must go, or the site keeps
    // displaying amounts derived from a price that no longer exists
    const eur = await price("EUR");
    expect(eur).toBeUndefined();
  });

  it("leaves a manual price alone when the base price changes", async () => {
    await env.DB.exec(
      `INSERT INTO variant_prices (variant_id, currency, amount_minor, source, updated_at) VALUES ('${THREADED}', 'GBP', 7500, 'manual', 1700000000)`,
    );

    await updateBasePrice(createDb(env.DB), THREADED, 20000);

    const gbp = await price("GBP");
    expect(gbp.amountMinor).toBe(7500);
    expect(gbp.source).toBe("manual");
  });
});

describe("setManualPrice / clearManualPrice", () => {
  it("marks an overridden price as manual", async () => {
    await setManualPrice(createDb(env.DB), THREADED, "EUR", 9500);

    const eur = await price("EUR");
    expect(eur.amountMinor).toBe(9500);
    expect(eur.source).toBe("manual");
    expect(eur.rateUsed).toBeNull();
  });

  it("refuses to override the base currency, which is the source of truth", async () => {
    await expect(
      setManualPrice(createDb(env.DB), THREADED, "USD", 9500),
    ).rejects.toThrow(/base currency/i);
  });

  it("removes the row on clear so the next cron recomputes it", async () => {
    await setManualPrice(createDb(env.DB), THREADED, "EUR", 9500);
    await clearManualPrice(createDb(env.DB), THREADED, "EUR");

    expect(await price("EUR")).toBeUndefined();
  });
});

describe("updateVariantLogistics", () => {
  it("updates stock, MOQ and lead time together", async () => {
    await updateVariantLogistics(createDb(env.DB), THREADED, {
      stock: 42,
      moq: 25,
      leadTimeDaysMin: 30,
      leadTimeDaysMax: 45,
    });

    const [variant] = await createDb(env.DB)
      .select()
      .from(schema.productVariants)
      .where(eq(schema.productVariants.id, THREADED));

    expect(variant.stock).toBe(42);
    expect(variant.moq).toBe(25);
    expect(variant.leadTimeDaysMin).toBe(30);
    expect(variant.leadTimeDaysMax).toBe(45);
  });

  it("rejects an MOQ below 1", async () => {
    await expect(
      updateVariantLogistics(createDb(env.DB), THREADED, {
        stock: 10,
        moq: 0,
        leadTimeDaysMin: null,
        leadTimeDaysMax: null,
      }),
    ).rejects.toThrow(/moq/i);
  });

  it("rejects a lead time range that runs backwards", async () => {
    await expect(
      updateVariantLogistics(createDb(env.DB), THREADED, {
        stock: 10,
        moq: 1,
        leadTimeDaysMin: 30,
        leadTimeDaysMax: 10,
      }),
    ).rejects.toThrow(/lead time/i);
  });

  it("rejects negative stock", async () => {
    await expect(
      updateVariantLogistics(createDb(env.DB), THREADED, {
        stock: -5,
        moq: 1,
        leadTimeDaysMin: null,
        leadTimeDaysMax: null,
      }),
    ).rejects.toThrow(/stock/i);
  });
});

describe("updateUseCasePage", () => {
  const useCaseId = `${PRODUCT_ID}-usecase-en-1`; // food-grade-dosing, has_own_page = 0

  it("promotes a use case to its own landing page", async () => {
    await updateUseCasePage(createDb(env.DB), useCaseId, {
      hasOwnPage: true,
      scenarioSlug: "food-grade-dosing",
    });

    const [row] = await createDb(env.DB)
      .select()
      .from(schema.productUseCases)
      .where(eq(schema.productUseCases.id, useCaseId));

    expect(row.hasOwnPage).toBe(1);
  });

  it("refuses to promote a use case with no slug, which would 404", async () => {
    await expect(
      updateUseCasePage(createDb(env.DB), useCaseId, {
        hasOwnPage: true,
        scenarioSlug: "",
      }),
    ).rejects.toThrow(/slug/i);
  });

  it("rejects a slug with characters that do not belong in a URL", async () => {
    await expect(
      updateUseCasePage(createDb(env.DB), useCaseId, {
        hasOwnPage: true,
        scenarioSlug: "Food Grade Dosing!",
      }),
    ).rejects.toThrow(/slug/i);
  });

  it("demotes a use case back into the product page", async () => {
    const promoted = `${PRODUCT_ID}-usecase-en-0`;
    await updateUseCasePage(createDb(env.DB), promoted, {
      hasOwnPage: false,
      scenarioSlug: "offshore-seawater-lines",
    });

    const [row] = await createDb(env.DB)
      .select()
      .from(schema.productUseCases)
      .where(eq(schema.productUseCases.id, promoted));

    expect(row.hasOwnPage).toBe(0);
  });
});

describe("createProduct", () => {
  it("creates a draft with one SKU and a base price", async () => {
    const created = await createProduct(createDb(env.DB), {
      slug: "gate-valve-dn80",
      name: "Gate Valve DN80",
      locale: "en",
      sku: "GV-316L-DN80",
      basePriceMinor: 24_900,
      stock: 30,
      moq: 5,
    });

    const [product] = await createDb(env.DB)
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, created.id));

    // A new product starts as a draft: publishing before it has images or other
    // languages means the crawler's first look is at an incomplete page
    expect(product.status).toBe("draft");
    expect(product.slug).toBe("gate-valve-dn80");
  });

  it("rejects a slug that is not URL-safe, since it goes straight into the URL", async () => {
    await expect(
      createProduct(createDb(env.DB), {
        slug: "Gate Valve DN80!",
        name: "x",
        locale: "en",
        sku: "S",
        basePriceMinor: 100,
        stock: 1,
        moq: 1,
      }),
    ).rejects.toThrow(/slug/i);
  });

  it("refuses a duplicate slug rather than creating a second page on the same URL", async () => {
    await expect(
      createProduct(createDb(env.DB), {
        slug: "stainless-ball-valve-dn50",
        name: "Clash",
        locale: "en",
        sku: "NEW-SKU",
        basePriceMinor: 100,
        stock: 1,
        moq: 1,
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("rejects an MOQ below 1 and negative stock", async () => {
    const base = {
      slug: "a-valve",
      name: "x",
      locale: "en" as const,
      sku: "S1",
      basePriceMinor: 100,
      stock: 1,
      moq: 1,
    };

    await expect(
      createProduct(createDb(env.DB), { ...base, moq: 0 }),
    ).rejects.toThrow(/moq/i);
    await expect(
      createProduct(createDb(env.DB), { ...base, slug: "b-valve", stock: -1 }),
    ).rejects.toThrow(/stock/i);
  });
});

describe("setProductStatus", () => {
  it("publishes a product that has a default-language name", async () => {
    await setProductStatus(createDb(env.DB), PRODUCT_ID, "archived");
    await setProductStatus(createDb(env.DB), PRODUCT_ID, "active");

    const [product] = await createDb(env.DB)
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, PRODUCT_ID));

    expect(product.status).toBe("active");
  });

  it("refuses to publish without an English name, which would ship a titleless page", async () => {
    const created = await createProduct(createDb(env.DB), {
      slug: "nameless-valve",
      name: "Temp",
      locale: "de",
      sku: "TMP-1",
      basePriceMinor: 100,
      stock: 1,
      moq: 1,
    });
    await env.DB.exec(
      `DELETE FROM product_translations WHERE product_id = '${created.id}'`,
    );

    await expect(
      setProductStatus(createDb(env.DB), created.id, "active"),
    ).rejects.toThrow(/product name/i);
  });

  it("allows archiving regardless of translation state", async () => {
    await expect(
      setProductStatus(createDb(env.DB), PRODUCT_ID, "archived"),
    ).resolves.toBeUndefined();
  });
});
