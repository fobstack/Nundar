import type { MetadataRoute } from "next";
import { LOCALES, type Locale } from "@/config/locales";
import type { Db } from "@/db/client";
import { absoluteUrl, localePath } from "@/lib/seo";
import {
  listProductSlugs,
  listProductUpdatedAt,
  listUseCasePages,
} from "@/lib/queries/products";

type SitemapEntry = MetadataRoute.Sitemap[number];

function languagesFor(pathFor: (locale: Locale) => string) {
  return Object.fromEntries(
    LOCALES.map((locale) => [locale, absoluteUrl(pathFor(locale))]),
  );
}

/**
 * 站点地图条目。
 *
 * 只收录 has_own_page = 1 的工况页——留在商品页内的工况没有独立 URL，
 * 收录它们等于往 sitemap 里塞 404。
 */
export async function buildSitemapEntries(db: Db): Promise<SitemapEntry[]> {
  const [slugs, useCasePages, updatedAtBySlug] = await Promise.all([
    listProductSlugs(db),
    listUseCasePages(db),
    listProductUpdatedAt(db),
  ]);

  const entries: SitemapEntry[] = [];

  for (const locale of LOCALES) {
    entries.push({
      url: absoluteUrl(localePath(locale)),
      changeFrequency: "daily",
      priority: 1,
      alternates: { languages: languagesFor((l) => localePath(l)) },
    });
    entries.push({
      url: absoluteUrl(localePath(locale, "products")),
      changeFrequency: "daily",
      priority: 0.8,
      alternates: {
        languages: languagesFor((l) => localePath(l, "products")),
      },
    });
  }

  for (const locale of LOCALES) {
    for (const slug of slugs) {
      const updatedAt = updatedAtBySlug[slug];
      entries.push({
        url: absoluteUrl(localePath(locale, "products", slug)),
        lastModified: updatedAt ? new Date(updatedAt * 1000) : undefined,
        changeFrequency: "weekly",
        priority: 0.7,
        alternates: {
          languages: languagesFor((l) => localePath(l, "products", slug)),
        },
      });
    }
  }

  // 工况页的 slug 逐语言不同，alternates 需按 groupKey 汇总后逐语言取真实 slug
  const byGroup = new Map<string, Partial<Record<Locale, string>>>();
  for (const page of useCasePages) {
    const key = `${page.productSlug}::${page.groupKey}`;
    const existing = byGroup.get(key) ?? {};
    existing[page.locale] = page.useCaseSlug;
    byGroup.set(key, existing);
  }

  for (const page of useCasePages) {
    const key = `${page.productSlug}::${page.groupKey}`;
    const slugByLocale = byGroup.get(key) ?? {};

    entries.push({
      url: absoluteUrl(
        localePath(page.locale, "products", page.productSlug, page.useCaseSlug),
      ),
      lastModified: updatedAtBySlug[page.productSlug]
        ? new Date(updatedAtBySlug[page.productSlug] * 1000)
        : undefined,
      changeFrequency: "monthly",
      priority: 0.6,
      alternates: {
        languages: Object.fromEntries(
          Object.entries(slugByLocale).map(([locale, slug]) => [
            locale,
            absoluteUrl(
              localePath(locale as Locale, "products", page.productSlug, slug),
            ),
          ]),
        ),
      },
    });
  }

  return entries;
}
