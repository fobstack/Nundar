import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { LOCALES, defaultCurrencyForLocale, isLocale } from "@/config/locales";
import { getDbAsync } from "@/db/client";
import { formatMoney } from "@/lib/money";
import { listActiveProducts } from "@/lib/queries/products";
import { absoluteUrl, buildAlternates, localePath } from "@/lib/seo";

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

  const currency = defaultCurrencyForLocale(locale);
  const db = await getDbAsync();
  const products = await listActiveProducts(db, locale, currency);

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
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

      <h1 className="text-3xl font-semibold tracking-tight">Products</h1>

      <ul className="mt-10 space-y-6">
        {products.map((product) => (
          <li key={product.id} className="border-b border-neutral-200 pb-6">
            <h2 className="text-lg font-medium">
              <Link
                className="underline underline-offset-4"
                href={localePath(locale, "products", product.slug)}
              >
                {product.name}
              </Link>
            </h2>
            {product.summary ? (
              <p className="mt-1 text-sm text-neutral-600">{product.summary}</p>
            ) : null}
            {product.fromPriceMinor !== null && product.priceCurrency ? (
              <p className="mt-2 text-sm">
                {formatMoney(product.fromPriceMinor, product.priceCurrency, locale)}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
