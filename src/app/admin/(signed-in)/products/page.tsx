import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { DEFAULT_LOCALE, LOCALES } from "@/config/locales";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { getAdminT } from "@/lib/admin/locale";
import { requireAdmin } from "@/lib/auth/guard";
import { formatMoney } from "@/lib/money";
import {
  Card,
  Chip,
  PageHead,
  ProductStatusChip,
  TableEmpty,
} from "../../_components/ui";

export default async function AdminProductsPage() {
  await requireAdmin();
  const { t } = await getAdminT();
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
      (row) => row.productId === productId && row.locale === DEFAULT_LOCALE,
    )?.name ?? t.products.notTranslated;

  // Translation completeness is where a multilingual site quietly falls apart, so
  // the list itself has to show which languages are behind
  const missingLocales = (productId: string) =>
    LOCALES.filter(
      (locale) =>
        !translations.some(
          (row) => row.productId === productId && row.locale === locale,
        ),
    );

  return (
    <>
      <PageHead
        title={t.products.title}
        action={
          <Link className="admin-btn admin-btn-primary" href="/admin/products/new">
            {t.products.newProduct}
          </Link>
        }
      />

      <Card padded={false}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t.products.name}</th>
              <th>{t.products.slug}</th>
              <th>{t.products.status}</th>
              <th className="num">{t.products.skus}</th>
              <th className="num">{t.products.from}</th>
              <th>{t.products.translations}</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <TableEmpty colSpan={6}>{t.products.empty}</TableEmpty>
            ) : (
              products.map((product) => {
                const own = variants.filter((v) => v.productId === product.id);
                const ownPrices = prices.filter((p) =>
                  own.some((v) => v.id === p.variantId),
                );
                const from = ownPrices.length
                  ? Math.min(...ownPrices.map((p) => p.amountMinor))
                  : null;
                const missing = missingLocales(product.id);

                return (
                  <tr key={product.id}>
                    <td>
                      <Link href={`/admin/products/${product.slug}`}>
                        {nameOf(product.id)}
                      </Link>
                    </td>
                    <td style={{ color: "var(--a-ink-3)" }}>{product.slug}</td>
                    <td>
                      <ProductStatusChip status={product.status} />
                    </td>
                    <td className="num">{own.length}</td>
                    <td className="num">
                      {from === null ? "—" : formatMoney(from, "USD", "en")}
                    </td>
                    <td>
                      {missing.length === 0 ? (
                        <Chip tone="ok">{t.products.complete}</Chip>
                      ) : (
                        <Chip tone="attention">
                          {t.products.missing} {missing.join(", ")}
                        </Chip>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
