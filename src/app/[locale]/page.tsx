import { notFound } from "next/navigation";
import { LOCALES, defaultCurrencyForLocale, isLocale } from "@/config/locales";
import { getDbAsync } from "@/db/client";
import { formatMoney } from "@/lib/money";
import { listActiveProducts } from "@/lib/queries/products";

// 四门语言的首页在构建期静态生成，爬虫拿到的是完整内容
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
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
  const products = await listActiveProducts(db, locale, currency);

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">shopcf</h1>
      <ul className="mt-10 space-y-6">
        {products.map((product) => (
          <li key={product.id} className="border-b border-neutral-200 pb-6">
            <h2 className="text-lg font-medium">{product.name}</h2>
            {product.summary ? (
              <p className="mt-1 text-sm text-neutral-600">{product.summary}</p>
            ) : null}
            {/* 用查询返回的实际币种格式化：该币种缺价时会回落到基准币种，
                直接用 locale 默认币种会把美元金额挂上欧元符号 */}
            {product.fromPriceMinor !== null && product.priceCurrency ? (
              <p className="mt-2 text-sm">
                {formatMoney(product.fromPriceMinor, product.priceCurrency, locale)}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
