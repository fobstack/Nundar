import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrderStatus } from "@/components/OrderStatus";
import { isLocale } from "@/config/locales";

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

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Thank you</h1>
      <OrderStatus orderNo={orderNo} locale={locale} />
    </main>
  );
}
