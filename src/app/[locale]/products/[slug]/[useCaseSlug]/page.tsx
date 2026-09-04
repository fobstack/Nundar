import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { defaultCurrencyForLocale, isLocale } from "@/config/locales";
import { SITE } from "@/config/site";
import { getDbAsync } from "@/db/client";
import {
  getProductDetail,
  getUseCaseAlternates,
  listUseCasePages,
  type ProductDetail,
} from "@/lib/queries/products";
import {
  absoluteUrl,
  buildAlternatesFromMap,
  localePath,
} from "@/lib/seo";
import { breadcrumbJsonLd, buildUseCaseJsonLd } from "@/lib/seo/jsonld";

type PageParams = { locale: string; slug: string; useCaseSlug: string };

/**
 * 只为 has_own_page = 1 的工况生成页面。
 * 内容不够厚的工况留在商品页内作为板块——强行成页会被判为 thin content。
 */
export async function generateStaticParams() {
  const db = await getDbAsync();
  const pages = await listUseCasePages(db);

  return pages.map((page) => ({
    locale: page.locale,
    slug: page.productSlug,
    useCaseSlug: page.useCaseSlug,
  }));
}

function findUseCase(product: ProductDetail, useCaseSlug: string) {
  return product.useCases.find(
    (candidate) => candidate.hasOwnPage && candidate.scenarioSlug === useCaseSlug,
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale, slug, useCaseSlug } = await params;
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
  const useCase = product ? findUseCase(product, useCaseSlug) : undefined;
  if (!product || !useCase) {
    return {};
  }

  const description = useCase.body?.slice(0, 160) ?? product.summary ?? undefined;

  // 各语言的工况 slug 是本地化的，必须逐语言查真实 slug，
  // 否则 hreflang 会把爬虫指向不存在的页面
  const slugByLocale = await getUseCaseAlternates(db, slug, locale, useCaseSlug);

  return {
    title: `${useCase.scenarioTitle} | ${product.name}`,
    description,
    // canonical 自指：指向商品页等于主动放弃这个长尾词的排名
    alternates: buildAlternatesFromMap(
      locale,
      slugByLocale ?? { [locale]: useCaseSlug },
      (l, localeSlug) => localePath(l, "products", slug, localeSlug),
    ),
    openGraph: {
      title: useCase.scenarioTitle,
      description,
      url: absoluteUrl(localePath(locale, "products", slug, useCaseSlug)),
      type: "article",
      locale,
    },
  };
}

export default async function UseCasePage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale, slug, useCaseSlug } = await params;
  if (!isLocale(locale)) {
    notFound();
  }

  const db = await getDbAsync();
  const product = await getProductDetail(
    db,
    slug,
    locale,
    defaultCurrencyForLocale(locale),
  );
  const useCase = product ? findUseCase(product, useCaseSlug) : undefined;
  if (!product || !useCase) {
    notFound();
  }

  const productUrl = absoluteUrl(localePath(locale, "products", slug));
  const pageUrl = absoluteUrl(localePath(locale, "products", slug, useCaseSlug));
  const siblings = product.useCases.filter(
    (candidate) =>
      candidate.hasOwnPage &&
      candidate.scenarioSlug &&
      candidate.scenarioSlug !== useCaseSlug,
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <JsonLd
        data={buildUseCaseJsonLd({
          headline: useCase.scenarioTitle,
          body: useCase.body,
          url: pageUrl,
          productName: product.name,
          productUrl,
          locale,
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
          { name: useCase.scenarioTitle, url: pageUrl },
        ])}
      />

      <nav className="text-sm text-neutral-500">
        <Link
          className="underline underline-offset-4"
          href={localePath(locale, "products", slug)}
        >
          {product.name}
        </Link>
      </nav>

      <h1 className="mt-4 text-3xl font-semibold tracking-tight">
        {useCase.scenarioTitle}
      </h1>

      {useCase.body ? (
        <p className="mt-6 whitespace-pre-line leading-relaxed">
          {useCase.body}
        </p>
      ) : null}

      {useCase.specHighlights ? (
        <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {Object.entries(useCase.specHighlights).map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-neutral-500">{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {siblings.length ? (
        <section className="mt-12 border-t border-neutral-200 pt-6">
          <h2 className="text-sm font-medium text-neutral-500">
            Other applications
          </h2>
          <ul className="mt-3 space-y-2">
            {siblings.map((sibling) => (
              <li key={sibling.id}>
                <Link
                  className="underline underline-offset-4"
                  href={localePath(
                    locale,
                    "products",
                    slug,
                    sibling.scenarioSlug!,
                  )}
                >
                  {sibling.scenarioTitle}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
