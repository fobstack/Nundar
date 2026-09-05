import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { defaultCurrencyForLocale, isLocale } from "@/config/locales";
import {
  CURRENCY_COOKIE,
  parseCurrencyCookie,
} from "@/lib/currency-preference";
import { localePath } from "@/lib/seo";
import { buildSiteUrls } from "@/lib/site-urls";
import { getTheme } from "@/themes/registry";

export const metadata: Metadata = {
  title: "Cart",
  // 购物车是用户私有数据且无 SEO 价值；robots.txt 也已 disallow，双保险
  robots: { index: false, follow: false },
};

export default async function CartPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }

  // 动态页可以直接读 cookie 里的币种偏好；静态页则由 LiveStock 客户端覆盖
  const store = await cookies();
  const currency = parseCurrencyCookie(
    store.get(CURRENCY_COOKIE)?.value,
    defaultCurrencyForLocale(locale),
  );

  const theme = getTheme();
  const urls = buildSiteUrls(locale, (target) => localePath(target, "cart"));

  return (
    <theme.Shell locale={locale} currency={currency} urls={urls}>
      <theme.CartView locale={locale} currency={currency} urls={urls} />
    </theme.Shell>
  );
}
