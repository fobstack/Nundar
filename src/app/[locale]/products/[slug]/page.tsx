import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { LOCALES, defaultCurrencyForLocale, isLocale } from "@/config/locales";
import { SITE } from "@/config/site";
import { getDbAsync } from "@/db/client";
import { getProductDetail, listProductSlugs } from "@/lib/queries/products";
import { absoluteUrl, buildAlternates, localePath } from "@/lib/seo";
import { breadcrumbJsonLd, productJsonLd } from "@/lib/seo/jsonld";
import { buildSiteUrls } from "@/lib/site-urls";
import { getTheme } from "@/themes/registry";

type PageParams = { locale: string; slug: string };

// Four languages times every sellable product, all generated at build time, so a
// crawler receives complete content
export async function generateStaticParams() {
  const db = await getDbAsync();
  const slugs = await listProductSlugs(db);

  return LOCALES.flatMap((locale) => slugs.map((slug) => ({ locale, slug })));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) {
    return {};
  }

  const db = await getDbAsync();
  const product = await getProductDetail(
    db,
    slug,
    locale,
    defaultCurrencyForLocale(locale),
  );
  if (!product) {
    return {};
  }

  return {
    title: product.seoTitle ?? product.name,
    description: product.seoDescription ?? product.summary ?? undefined,
    alternates: buildAlternates(locale, (l) => localePath(l, "products", slug)),
    openGraph: {
      title: product.seoTitle ?? product.name,
      description: product.seoDescription ?? product.summary ?? undefined,
      url: absoluteUrl(localePath(locale, "products", slug)),
      type: "website",
      locale,
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) {
    notFound();
  }

  const currency = defaultCurrencyForLocale(locale);
  const db = await getDbAsync();
  const product = await getProductDetail(db, slug, locale, currency);
  if (!product) {
    notFound();
  }

  const productUrl = absoluteUrl(localePath(locale, "products", slug));
  const theme = getTheme();

  // The slug is language-independent, so switching language stays on this product
  const urls = {
    ...buildSiteUrls(locale, (target) => localePath(target, "products", slug)),
    useCase: (scenarioSlug: string) =>
      localePath(locale, "products", slug, scenarioSlug),
  };

  return (
    <theme.Shell locale={locale} currency={currency} urls={urls}>
      {/* Structured data stays in the route layer: swapping themes must never
          affect SEO */}
      <JsonLd
        data={productJsonLd({
          name: product.name,
          description: product.description ?? product.summary,
          url: productUrl,
          variants: product.variants,
        })}
      />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: SITE.name, url: absoluteUrl(localePath(locale)) },
          { name: "Products", url: absoluteUrl(localePath(locale, "products")) },
          { name: product.name, url: productUrl },
        ])}
      />

      <theme.ProductDetailView
        locale={locale}
        currency={currency}
        product={product}
        urls={urls}
      />
    </theme.Shell>
  );
}
