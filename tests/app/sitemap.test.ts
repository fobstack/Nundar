import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { SITE } from "@/config/site";
import { createDb } from "@/db/client";
import { buildSitemapEntries } from "@/lib/seo/sitemap";
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

describe("buildSitemapEntries", () => {
  it("lists the home and products pages in every locale", async () => {
    const entries = await buildSitemapEntries(createDb(env.DB));
    const urls = entries.map((e) => e.url);

    for (const locale of ["en", "de", "fr", "es"]) {
      expect(urls).toContain(`${SITE.url}/${locale}`);
      expect(urls).toContain(`${SITE.url}/${locale}/products`);
    }
  });

  it("lists every product once per locale", async () => {
    const entries = await buildSitemapEntries(createDb(env.DB));
    const productUrls = entries.filter((e) =>
      /\/products\/stainless-ball-valve-dn50$/.test(e.url),
    );

    expect(productUrls).toHaveLength(4);
  });

  it("includes use-case landing pages under their localised slugs", async () => {
    const entries = await buildSitemapEntries(createDb(env.DB));
    const urls = entries.map((e) => e.url);

    expect(urls).toContain(
      `${SITE.url}/de/products/stainless-ball-valve-dn50/offshore-seewasserleitungen`,
    );
    expect(urls).toContain(
      `${SITE.url}/fr/products/stainless-ball-valve-dn50/circuits-eau-de-mer-offshore`,
    );
  });

  it("excludes use cases that have no landing page", async () => {
    const entries = await buildSitemapEntries(createDb(env.DB));
    const urls = entries.map((e) => e.url).join(" ");

    // food-grade-dosing 的 has_own_page = 0，只作为商品页内板块存在
    expect(urls).not.toContain("food-grade-dosing");
  });

  it("excludes archived products entirely", async () => {
    await env.DB.exec("UPDATE products SET status = 'archived'");

    const entries = await buildSitemapEntries(createDb(env.DB));
    const urls = entries.map((e) => e.url).join(" ");

    expect(urls).not.toContain("stainless-ball-valve-dn50");
    // 首页与列表页仍在
    expect(urls).toContain(`${SITE.url}/en`);
  });

  it("carries language alternates on every entry", async () => {
    const entries = await buildSitemapEntries(createDb(env.DB));

    for (const entry of entries) {
      expect(entry.alternates?.languages).toBeDefined();
      expect(
        Object.keys(entry.alternates!.languages!).length,
      ).toBeGreaterThan(0);
    }
  });

  it("sets lastModified from the product's updated timestamp", async () => {
    const entries = await buildSitemapEntries(createDb(env.DB));
    const productEntry = entries.find((e) =>
      e.url.endsWith("/en/products/stainless-ball-valve-dn50"),
    );

    expect(productEntry!.lastModified).toBeInstanceOf(Date);
  });
});
