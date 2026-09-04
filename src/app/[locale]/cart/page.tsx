import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CartPageView } from "@/components/CartView";
import { defaultCurrencyForLocale, isLocale } from "@/config/locales";

export const metadata: Metadata = {
  title: "Cart",
  // 购物车没有 SEO 价值且是用户私有数据，robots.txt 也已 disallow
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

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Cart</h1>
      <CartPageView locale={locale} currency={defaultCurrencyForLocale(locale)} />
    </main>
  );
}
