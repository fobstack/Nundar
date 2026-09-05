import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/config/locales";
import { localePath } from "@/lib/seo";
import { buildSiteUrls } from "@/lib/site-urls";
import { getTheme } from "@/themes/registry";
import { defaultCurrencyForLocale } from "@/config/locales";

export const metadata: Metadata = {
  title: "Order",
  robots: { index: false, follow: false },
};

export default async function OrderPage({
  params,
}: {
  params: Promise<{ locale: string; orderNo: string }>;
}) {
  const { locale, orderNo } = await params;
  if (!isLocale(locale)) {
    notFound();
  }

  const theme = getTheme();
  // 单号是这一单专有的，切语言留在同一张订单上
  const urls = buildSiteUrls(locale, (target) =>
    localePath(target, "orders", orderNo),
  );

  return (
    <theme.Shell
      locale={locale}
      currency={defaultCurrencyForLocale(locale)}
      urls={urls}
    >
      <theme.OrderView locale={locale} orderNo={orderNo} urls={urls} />
    </theme.Shell>
  );
}
