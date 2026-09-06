import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DEFAULT_LOCALE, LOCALES } from "@/config/locales";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { getAdminT } from "@/lib/admin/locale";
import { requireAdmin } from "@/lib/auth/guard";
import { formatMoney } from "@/lib/money";
import { Chip, PageHead, ProductStatusChip } from "../../_components/ui";

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
          <Button render={<Link href="/admin/products/new" />}>
            {t.products.newProduct}
          </Button>
        }
      />

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.products.name}</TableHead>
              <TableHead>{t.products.slug}</TableHead>
              <TableHead>{t.products.status}</TableHead>
              <TableHead className="text-right">{t.products.skus}</TableHead>
              <TableHead className="text-right">{t.products.from}</TableHead>
              <TableHead>{t.products.translations}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.length === 0 ? (
              <TableRow>
                <TableCell
                  className="h-24 text-center text-muted-foreground"
                  colSpan={6}
                >
                  {t.products.empty}
                </TableCell>
              </TableRow>
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
                  <TableRow key={product.id}>
                    <TableCell>
                      <Link
                        className="font-medium text-primary hover:underline"
                        href={`/admin/products/${product.slug}`}
                      >
                        {nameOf(product.id)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {product.slug}
                    </TableCell>
                    <TableCell>
                      <ProductStatusChip status={product.status} />
                    </TableCell>
                    <TableCell className="tabular text-right">{own.length}</TableCell>
                    <TableCell className="tabular text-right">
                      {from === null ? "—" : formatMoney(from, "USD", "en")}
                    </TableCell>
                    <TableCell>
                      {missing.length === 0 ? (
                        <Chip tone="ok">{t.products.complete}</Chip>
                      ) : (
                        <Chip tone="attention">
                          {t.products.missing} {missing.join(", ")}
                        </Chip>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
