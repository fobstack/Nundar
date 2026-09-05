import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LOCALES, defaultCurrencyForLocale, isLocale } from "@/config/locales";
import { SITE } from "@/config/site";
import { getDbAsync } from "@/db/client";
import { listActiveProducts, listUseCasePages } from "@/lib/queries/products";
import { buildAlternates, localePath } from "@/lib/seo";
import { buildSiteUrls } from "@/lib/site-urls";
import { getTheme } from "@/themes/registry";

// 四门语言的首页在构建期静态生成，爬虫拿到的是完整内容
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
    title: SITE.name,
    alternates: buildAlternates(locale, (l) => localePath(l)),
  };
}

export default async function HomePage({
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
  const [products, useCasePages] = await Promise.all([
    listActiveProducts(db, locale, currency),
    listUseCasePages(db),
  ]);

  const productNameBySlug = new Map(
    products.map((product) => [product.slug, product.name]),
  );

  // 首页给工况落地页导流：它们是长尾词矩阵的主力，藏在商品页里传不到权重
  const applications = useCasePages
    .filter((page) => page.locale === locale)
    .map((page) => ({
      title: page.useCaseTitle,
      productName: productNameBySlug.get(page.productSlug) ?? page.productSlug,
      href: localePath(locale, "products", page.productSlug, page.useCaseSlug),
    }));

  const theme = getTheme();
  const urls = {
    ...buildSiteUrls(locale, (target) => localePath(target)),
    product: (slug: string) => localePath(locale, "products", slug),
  };

  return (
    <theme.Shell locale={locale} currency={currency} urls={urls}>
      <theme.HomeView
        locale={locale}
        currency={currency}
        products={products}
        applications={applications}
        urls={urls}
      />
    </theme.Shell>
  );
}
