import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { LOCALES, defaultCurrencyForLocale, isLocale } from "@/config/locales";
import { getDbAsync } from "@/db/client";
import { listActiveProducts } from "@/lib/queries/products";
import { absoluteUrl, buildAlternates, localePath } from "@/lib/seo";
import { buildSiteUrls } from "@/lib/site-urls";
import { getTheme } from "@/themes/registry";

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }

  return {
    title: "Products",
    alternates: buildAlternates(locale, (l) => localePath(l, "products")),
  };
}

export default async function ProductsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }

  const db = await getDbAsync();
  const currency = defaultCurrencyForLocale(locale);
  const products = await listActiveProducts(db, locale, currency);

  const theme = getTheme();
  const urls = {
    ...buildSiteUrls(locale, (target) => localePath(target, "products")),
    product: (slug: string) => localePath(locale, "products", slug),
  };

  return (
    <theme.Shell locale={locale} currency={currency} urls={urls}>
      {/* 结构化数据留在路由层：换主题绝不该影响 SEO */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          url: absoluteUrl(localePath(locale, "products")),
          mainEntity: {
            "@type": "ItemList",
            itemListElement: products.map((product, index) => ({
              "@type": "ListItem",
              position: index + 1,
              name: product.name,
              url: absoluteUrl(localePath(locale, "products", product.slug)),
            })),
          },
        }}
      />

      <theme.ProductListView
        locale={locale}
        currency={currency}
        products={products}
        urls={urls}
      />
    </theme.Shell>
  );
}
