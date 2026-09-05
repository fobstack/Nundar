import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DEFAULT_LOCALE, isLocale } from "@/config/locales";
import { localePath } from "@/lib/seo";
import { buildSiteUrls } from "@/lib/site-urls";
import { getStorefrontMessages } from "@/lib/storefront/i18n";
import { getTheme } from "@/themes/registry";
import { defaultCurrencyForLocale } from "@/config/locales";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  // metadata cannot call notFound(); the page itself rejects an unknown
  // locale, so falling back to the default here is enough for the title
  const t = getStorefrontMessages(isLocale(locale) ? locale : DEFAULT_LOCALE);

  return {
    title: t.page.order,
    robots: { index: false, follow: false },
  };
}

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
  const t = getStorefrontMessages(locale);
  // The order number belongs to this order alone, so switching language stays on it
  const urls = buildSiteUrls(locale, (target) =>
    localePath(target, "orders", orderNo),
  );

  return (
    <theme.Shell
      locale={locale}
      currency={defaultCurrencyForLocale(locale)}
      t={t}
      urls={urls}
    >
      <theme.OrderView locale={locale} t={t} orderNo={orderNo} urls={urls} />
    </theme.Shell>
  );
}
