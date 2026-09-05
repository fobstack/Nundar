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
  // A cart is private to one visitor and worth nothing to search; robots.txt
  // disallows it too, and both belts are deliberate
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

  // A dynamic page can read the currency preference from the cookie directly;
  // static pages get theirs from LiveStock on the client
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
