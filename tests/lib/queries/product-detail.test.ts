import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import {
  getProductDetail,
  getUseCaseAlternates,
  listProductSlugs,
  listUseCasePages,
} from "@/lib/queries/products";
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

const SLUG = "stainless-ball-valve-dn50";

describe("getProductDetail", () => {
  it("returns null for an unknown slug", async () => {
    const detail = await getProductDetail(
      createDb(env.DB),
      "no-such-product",
      "en",
      "USD",
    );
    expect(detail).toBeNull();
  });

  it("returns null for an archived product", async () => {
    await env.DB.exec("UPDATE products SET status = 'archived'");

    const detail = await getProductDetail(createDb(env.DB), SLUG, "en", "USD");
    expect(detail).toBeNull();
  });

  it("returns the translation for the requested locale", async () => {
    const detail = await getProductDetail(createDb(env.DB), SLUG, "fr", "EUR");

    expect(detail).not.toBeNull();
    expect(detail!.name).toBe("Vanne à bille inox DN50");
    expect(detail!.description).toContain("acier inoxydable 316L");
  });

  it("returns features and use cases ordered by sort order", async () => {
    const detail = await getProductDetail(createDb(env.DB), SLUG, "en", "USD");

    expect(detail!.features.map((f) => f.title)).toEqual([
      "316L stainless body",
      "Full bore, zero flow restriction",
    ]);
    expect(detail!.useCases.map((u) => u.scenarioSlug)).toEqual([
      "offshore-seawater-lines",
      "food-grade-dosing",
    ]);
  });

  it("marks which use cases have their own landing page", async () => {
    const detail = await getProductDetail(createDb(env.DB), SLUG, "en", "USD");

    const withPage = detail!.useCases.filter((u) => u.hasOwnPage);
    expect(withPage.map((u) => u.scenarioSlug)).toEqual([
      "offshore-seawater-lines",
    ]);
  });

  it("returns variants with MOQ and lead time", async () => {
    const detail = await getProductDetail(createDb(env.DB), SLUG, "en", "USD");

    const threaded = detail!.variants.find(
      (v) => v.sku === "BV-316L-DN50-NPT",
    );
    expect(threaded!.moq).toBe(10);
    expect(threaded!.leadTimeDaysMin).toBe(15);
    expect(threaded!.leadTimeDaysMax).toBe(20);
    expect(threaded!.priceMinor).toBe(9900);
    expect(threaded!.priceCurrency).toBe("USD");
  });

  it("falls back to the base currency and reports it", async () => {
    const detail = await getProductDetail(createDb(env.DB), SLUG, "de", "EUR");

    const threaded = detail!.variants.find(
      (v) => v.sku === "BV-316L-DN50-NPT",
    );
    expect(threaded!.priceMinor).toBe(9900);
    expect(threaded!.priceCurrency).toBe("USD");
  });

  it("uses the requested currency once a price exists for it", async () => {
    await env.DB.exec(
      "INSERT INTO variant_prices (variant_id, currency, amount_minor, source, updated_at) VALUES ('seed-variant-dn50-threaded', 'EUR', 9199, 'auto', 1700000000)",
    );

    const detail = await getProductDetail(createDb(env.DB), SLUG, "de", "EUR");
    const threaded = detail!.variants.find(
      (v) => v.sku === "BV-316L-DN50-NPT",
    );

    expect(threaded!.priceMinor).toBe(9199);
    expect(threaded!.priceCurrency).toBe("EUR");
  });
});

describe("listProductSlugs", () => {
  it("returns slugs of active products only", async () => {
    expect(await listProductSlugs(createDb(env.DB))).toEqual([SLUG]);

    await env.DB.exec("UPDATE products SET status = 'archived'");
    expect(await listProductSlugs(createDb(env.DB))).toEqual([]);
  });
});

describe("listUseCasePages", () => {
  it("returns only use cases flagged to have their own page", async () => {
    const pages = await listUseCasePages(createDb(env.DB));

    expect(pages).toHaveLength(4); // one per language
    expect(pages.every((p) => p.productSlug === SLUG)).toBe(true);
    expect(pages.map((p) => p.locale).sort()).toEqual(["de", "en", "es", "fr"]);
  });

  it("excludes use cases belonging to archived products", async () => {
    await env.DB.exec("UPDATE products SET status = 'archived'");
    expect(await listUseCasePages(createDb(env.DB))).toEqual([]);
  });
});

describe("getUseCaseAlternates", () => {
  it("maps each locale to that locale's own landing-page slug", async () => {
    const alternates = await getUseCaseAlternates(
      createDb(env.DB),
      SLUG,
      "en",
      "offshore-seawater-lines",
    );

    // hreflang must point at a slug that exists in that language; pointing at the
    // English one gives a 404
    expect(alternates).toEqual({
      en: "offshore-seawater-lines",
      de: "offshore-seewasserleitungen",
      fr: "circuits-eau-de-mer-offshore",
      es: "lineas-agua-de-mar-offshore",
    });
  });

  it("resolves from a non-default locale too", async () => {
    const alternates = await getUseCaseAlternates(
      createDb(env.DB),
      SLUG,
      "de",
      "offshore-seewasserleitungen",
    );

    expect(alternates!.fr).toBe("circuits-eau-de-mer-offshore");
  });

  it("returns null when the use case has no landing page in that locale", async () => {
    expect(
      await getUseCaseAlternates(createDb(env.DB), SLUG, "en", "food-grade-dosing"),
    ).toBeNull();
  });

  it("omits locales whose translation is missing rather than guessing a slug", async () => {
    await env.DB.exec(
      "DELETE FROM product_use_cases WHERE locale = 'fr' AND group_key = 'offshore-seawater'",
    );

    const alternates = await getUseCaseAlternates(
      createDb(env.DB),
      SLUG,
      "en",
      "offshore-seawater-lines",
    );

    expect(alternates!.fr).toBeUndefined();
    expect(alternates!.de).toBe("offshore-seewasserleitungen");
  });
});
