import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import {
  getLocaleCoverage,
  getTranslationStatus,
} from "@/lib/admin/translations";
import { seedDatabase } from "@/scripts/seed";

const PRODUCT_ID = "seed-ball-valve-dn50";

beforeEach(async () => {
  await env.DB.exec("DELETE FROM variant_prices");
  await env.DB.exec("DELETE FROM product_variants");
  await env.DB.exec("DELETE FROM product_use_cases");
  await env.DB.exec("DELETE FROM product_features");
  await env.DB.exec("DELETE FROM product_translations");
  await env.DB.exec("DELETE FROM products");
  await seedDatabase(createDb(env.DB));
});

describe("getTranslationStatus", () => {
  it("reports a fully translated product as complete", async () => {
    const [status] = await getTranslationStatus(createDb(env.DB), "de");

    expect(status.completeness).toBe(100);
    expect(status.targetName).toBe("Edelstahl-Kugelhahn DN50");
  });

  it("drops to a partial score when a field is missing", async () => {
    await env.DB.exec(
      `UPDATE product_translations SET seo_title = NULL WHERE product_id = '${PRODUCT_ID}' AND locale = 'de'`,
    );

    const [status] = await getTranslationStatus(createDb(env.DB), "de");

    expect(status.completeness).toBeLessThan(100);
    const seoTitle = status.fields.find((f) => f.field === "seoTitle");
    expect(seoTitle).toMatchObject({ sourceFilled: true, targetFilled: false });
  });

  it("reports zero when the language has no translation at all", async () => {
    await env.DB.exec(
      `DELETE FROM product_translations WHERE product_id = '${PRODUCT_ID}' AND locale = 'es'`,
    );
    await env.DB.exec(
      `DELETE FROM product_features WHERE product_id = '${PRODUCT_ID}' AND locale = 'es'`,
    );
    await env.DB.exec(
      `DELETE FROM product_use_cases WHERE product_id = '${PRODUCT_ID}' AND locale = 'es'`,
    );

    const [status] = await getTranslationStatus(createDb(env.DB), "es");

    expect(status.completeness).toBe(0);
    expect(status.targetName).toBeNull();
  });

  it("flags a use case that exists in English but not in the target language", async () => {
    await env.DB.exec(
      `DELETE FROM product_use_cases WHERE product_id = '${PRODUCT_ID}' AND locale = 'fr' AND group_key = 'offshore-seawater'`,
    );

    const [status] = await getTranslationStatus(createDb(env.DB), "fr");
    const missing = status.useCases.filter((block) => block.missing);

    expect(missing).toHaveLength(1);
    expect(missing[0].groupKey).toBe("offshore-seawater");
    expect(missing[0].sourceTitle).toContain("offshore platform");
  });

  it("flags a missing feature translation", async () => {
    await env.DB.exec(
      `DELETE FROM product_features WHERE product_id = '${PRODUCT_ID}' AND locale = 'de' AND group_key = 'full-bore'`,
    );

    const [status] = await getTranslationStatus(createDb(env.DB), "de");
    expect(status.features.filter((f) => f.missing)).toHaveLength(1);
  });

  it("does not count a field the source language leaves empty", async () => {
    // When the source language has no summary, the target language missing one is
    // not a missing translation
    await env.DB.exec(
      `UPDATE product_translations SET summary = NULL WHERE product_id = '${PRODUCT_ID}'`,
    );

    const [status] = await getTranslationStatus(createDb(env.DB), "de");
    expect(status.completeness).toBe(100);
  });

  it("treats whitespace-only content as untranslated", async () => {
    await env.DB.exec(
      `UPDATE product_translations SET description = '   ' WHERE product_id = '${PRODUCT_ID}' AND locale = 'de'`,
    );

    const [status] = await getTranslationStatus(createDb(env.DB), "de");
    const description = status.fields.find((f) => f.field === "description");
    expect(description?.targetFilled).toBe(false);
  });

  it("ignores archived products", async () => {
    await env.DB.exec("UPDATE products SET status = 'archived'");
    expect(await getTranslationStatus(createDb(env.DB), "de")).toEqual([]);
  });
});

describe("getLocaleCoverage", () => {
  it("reports the source language as complete by definition", async () => {
    const coverage = await getLocaleCoverage(createDb(env.DB));
    const english = coverage.find((item) => item.locale === "en");

    expect(english?.completeness).toBe(100);
  });

  it("covers every shipped locale", async () => {
    const coverage = await getLocaleCoverage(createDb(env.DB));
    expect(coverage.map((item) => item.locale).sort()).toEqual([
      "de",
      "en",
      "es",
      "fr",
    ]);
  });

  it("drops the average when one language falls behind", async () => {
    await env.DB.exec(
      `DELETE FROM product_translations WHERE locale = 'es'`,
    );

    const coverage = await getLocaleCoverage(createDb(env.DB));
    const spanish = coverage.find((item) => item.locale === "es");

    expect(spanish!.completeness).toBeLessThan(100);
  });
});
