import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { DEFAULT_LOCALE, LOCALES } from "@/config/locales";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/auth/guard";
import { formatMoney } from "@/lib/money";

export default async function AdminProductsPage() {
  await requireAdmin();
  const db = getDb();

  const [products, translations, variants, prices] = await Promise.all([
    db.select().from(schema.products).orderBy(asc(schema.products.slug)),
    db.select().from(schema.productTranslations),
    db.select().from(schema.productVariants),
    db
      .select()
      .from(schema.variantPrices)
      .where(eq(schema.variantPrices.currency, "USD")),
  ]);

  const nameOf = (productId: string) =>
    translations.find(
      (t) => t.productId === productId && t.locale === DEFAULT_LOCALE,
    )?.name ?? "(untranslated)";

  // 翻译完整度是多语言站最容易失控的地方，列表页就要能一眼看出缺哪几门语言
  const missingLocales = (productId: string) =>
    LOCALES.filter(
      (locale) =>
        !translations.some(
          (t) => t.productId === productId && t.locale === locale,
        ),
    );

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
        <Link
          href="/admin/products/new"
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          New product
        </Link>
      </div>

      <table className="mt-8 w-full border-collapse bg-white text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left">
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Slug</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">SKUs</th>
            <th className="px-3 py-2">From</th>
            <th className="px-3 py-2">Translations</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => {
            const own = variants.filter((v) => v.productId === product.id);
            const ownPrices = prices.filter((p) =>
              own.some((v) => v.id === p.variantId),
            );
            const from = ownPrices.length
              ? Math.min(...ownPrices.map((p) => p.amountMinor))
              : null;
            const missing = missingLocales(product.id);

            return (
              <tr key={product.id} className="border-b border-neutral-100">
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/products/${product.slug}`}
                    className="underline underline-offset-4"
                  >
                    {nameOf(product.id)}
                  </Link>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{product.slug}</td>
                <td className="px-3 py-2">{product.status}</td>
                <td className="px-3 py-2">{own.length}</td>
                <td className="px-3 py-2">
                  {from === null ? "—" : formatMoney(from, "USD", "en")}
                </td>
                <td className="px-3 py-2">
                  {missing.length === 0 ? (
                    <span className="text-green-700">complete</span>
                  ) : (
                    <span className="text-amber-700">
                      missing {missing.join(", ")}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {products.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500">
          No products yet. Run <code>pnpm db:seed:local</code> to load the sample
          catalogue.
        </p>
      ) : null}
    </main>
  );
}
