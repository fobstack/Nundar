import type { Metadata } from "next";
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
import { buildSiteUrls } from "@/lib/site-urls";
import { getTheme } from "@/themes/registry";

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

  const currency = defaultCurrencyForLocale(locale);
  const db = await getDbAsync();
  const product = await getProductDetail(db, slug, locale, currency);
  const useCase = product ? findUseCase(product, useCaseSlug) : undefined;
  if (!product || !useCase) {
    notFound();
  }

  const productUrl = absoluteUrl(localePath(locale, "products", slug));
  const pageUrl = absoluteUrl(localePath(locale, "products", slug, useCaseSlug));

  const siblings = product.useCases
    .filter(
      (candidate) =>
        candidate.hasOwnPage &&
        candidate.scenarioSlug &&
        candidate.scenarioSlug !== useCaseSlug,
    )
    .map((candidate) => ({
      title: candidate.scenarioTitle,
      href: localePath(locale, "products", slug, candidate.scenarioSlug!),
    }));

  // 各语言的工况 slug 是本地化的，切语言必须查该语言的真实 slug，否则会跳到 404
  const slugByLocale = await getUseCaseAlternates(db, slug, locale, useCaseSlug);

  const theme = getTheme();
  const urls = {
    ...buildSiteUrls(locale, (target) => {
      const targetSlug = slugByLocale?.[target];
      return targetSlug
        ? localePath(target, "products", slug, targetSlug)
        : localePath(target, "products", slug);
    }),
    product: localePath(locale, "products", slug),
    useCase: (scenarioSlug: string) =>
      localePath(locale, "products", slug, scenarioSlug),
  };

  return (
    <theme.Shell locale={locale} currency={currency} urls={urls}>
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
          { name: "Products", url: absoluteUrl(localePath(locale, "products")) },
          { name: product.name, url: productUrl },
          { name: useCase.scenarioTitle, url: pageUrl },
        ])}
      />

      <theme.UseCaseView
        locale={locale}
        currency={currency}
        product={product}
        useCase={useCase}
        siblings={siblings}
        urls={urls}
      />
    </theme.Shell>
  );
}
