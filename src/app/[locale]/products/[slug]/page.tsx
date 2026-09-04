import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToCart } from "@/components/AddToCart";
import { JsonLd } from "@/components/JsonLd";
import { LiveStock } from "@/components/LiveStock";
import { LOCALES, defaultCurrencyForLocale, isLocale } from "@/config/locales";
import { SITE } from "@/config/site";
import { getDbAsync } from "@/db/client";
import { formatMoney } from "@/lib/money";
import { getProductDetail, listProductSlugs } from "@/lib/queries/products";
import { absoluteUrl, buildAlternates, localePath } from "@/lib/seo";
import { breadcrumbJsonLd, productJsonLd } from "@/lib/seo/jsonld";

type PageParams = { locale: string; slug: string };

// 四语言 × 全部在售商品，构建期全部静态生成，爬虫拿到完整内容
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
    alternates: buildAlternates(locale, (l) =>
      localePath(l, "products", slug),
    ),
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

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
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
          {
            name: "Products",
            url: absoluteUrl(localePath(locale, "products")),
          },
          { name: product.name, url: productUrl },
        ])}
      />

      {/* 静态页的库存与价格可能过期，hydration 后用实时数据覆盖 */}
      <LiveStock
        variantIds={product.variants.map((variant) => variant.id)}
        currency={currency}
        locale={locale}
      />

      <h1 className="text-3xl font-semibold tracking-tight">{product.name}</h1>
      {product.summary ? (
        <p className="mt-3 text-neutral-600">{product.summary}</p>
      ) : null}

      <section className="mt-8 space-y-3" aria-label="SKU">
        {product.variants.map((variant) => (
          <div
            key={variant.id}
            className="rounded border border-neutral-200 p-4"
            data-variant-id={variant.id}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{variant.sku}</span>
              {variant.priceMinor !== null && variant.priceCurrency ? (
                <span data-price>
                  {formatMoney(variant.priceMinor, variant.priceCurrency, locale)}
                </span>
              ) : null}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-neutral-600">
              {Object.entries(variant.optionValues).map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="capitalize">{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
              {variant.moq > 1 ? (
                <div className="contents">
                  <dt>MOQ</dt>
                  <dd>{variant.moq}</dd>
                </div>
              ) : null}
              {variant.leadTimeDaysMin !== null &&
              variant.leadTimeDaysMax !== null ? (
                <div className="contents">
                  <dt>Lead time</dt>
                  <dd data-lead-time>
                    {variant.leadTimeDaysMin}–{variant.leadTimeDaysMax} days
                  </dd>
                </div>
              ) : null}
              <div className="contents">
                <dt>Stock</dt>
                <dd data-stock>{variant.stock}</dd>
              </div>
            </dl>

            <AddToCart
              variantId={variant.id}
              moq={variant.moq}
              stock={variant.stock}
              locale={locale}
            />
          </div>
        ))}
      </section>

      {product.description ? (
        <section className="mt-12">
          <p className="whitespace-pre-line leading-relaxed">
            {product.description}
          </p>
        </section>
      ) : null}

      {product.features.length ? (
        <section className="mt-12">
          <h2 className="text-xl font-semibold">Features</h2>
          <ul className="mt-4 space-y-4">
            {product.features.map((feature) => (
              <li key={feature.id}>
                <h3 className="font-medium">{feature.title}</h3>
                {feature.body ? (
                  <p className="mt-1 text-sm text-neutral-600">{feature.body}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {product.useCases.length ? (
        <section className="mt-12">
          <h2 className="text-xl font-semibold">Applications</h2>
          <ul className="mt-4 space-y-6">
            {product.useCases.map((useCase) => (
              <li key={useCase.id}>
                <h3 className="font-medium">
                  {/* 内容够厚的工况有独立落地页，从这里内链过去传递权重 */}
                  {useCase.hasOwnPage && useCase.scenarioSlug ? (
                    <Link
                      className="underline underline-offset-4"
                      href={localePath(
                        locale,
                        "products",
                        slug,
                        useCase.scenarioSlug,
                      )}
                    >
                      {useCase.scenarioTitle}
                    </Link>
                  ) : (
                    useCase.scenarioTitle
                  )}
                </h3>
                {useCase.body ? (
                  <p className="mt-1 text-sm leading-relaxed text-neutral-600">
                    {useCase.body}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
