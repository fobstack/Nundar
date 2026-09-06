import { AlertTriangle, Clock, PackageMinus } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import type { Currency } from "@/config/currency";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { getDashboardStats } from "@/lib/admin/customers";
import { formatAdminDate } from "@/lib/admin/i18n";
import { getAdminT } from "@/lib/admin/locale";
import { requireAdmin } from "@/lib/auth/guard";
import { formatMoney } from "@/lib/money";
import { Chip, Figure, PageHead } from "../_components/ui";

/**
 * The overview.
 *
 * Built around one claim: people open an admin to work, not to read numbers. So
 * the queue of things needing a person comes first and carries the only
 * saturated colour on the page, and the reference figures sit quietly
 * underneath. Four identical stat cards across the top — the reflex layout —
 * would give an oversold order and the customer count the same weight, which is
 * exactly wrong.
 */
export default async function AdminHome() {
  const session = await requireAdmin();
  const { locale, t } = await getAdminT();
  const db = getDb();

  const [stats, rates] = await Promise.all([
    getDashboardStats(db),
    db.select().from(schema.exchangeRates),
  ]);

  const lastFetched = rates.length
    ? Math.max(...rates.map((rate) => rate.fetchedAt))
    : null;

  const revenue = Object.entries(stats.revenueByCurrency);
  const lowStock = stats.lowStockVariants;
  const clear =
    stats.oversoldOrders === 0 && lowStock.length === 0 && stats.pendingOrders === 0;

  return (
    <>
      <PageHead
        title={t.overview.title}
        description={`${t.overview.signedInAs} ${session.email} · ${
          session.role === "owner" ? t.settings.owner : t.settings.staff
        }`}
      />

      <section className="mb-10">
        <h2 className="mb-4 text-base font-semibold tracking-tight">
          {t.overview.needsYou}
        </h2>

        {clear ? (
          <Card>
            <CardContent className="flex items-center gap-3">
              <Chip tone="ok">{t.overview.allClear}</Chip>
              <span className="text-muted-foreground">{t.overview.allClearNote}</span>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {/* Paid, unfulfillable, and only a person can resolve it. The most
                serious thing the shop can be doing, so it leads. */}
            {stats.oversoldOrders > 0 ? (
              <Card>
                <CardContent>
                  <Link
                    className="flex items-center justify-between gap-4"
                    href="/admin/orders?status=oversold"
                  >
                    <span className="flex items-center gap-3">
                      <AlertTriangle
                        aria-hidden
                        className="size-4"
                        style={{ color: "var(--state-danger)" }}
                      />
                      <Chip tone="danger">{t.orders.oversoldWarning}</Chip>
                      <span className="text-muted-foreground">
                        {t.overview.oversoldNote}
                      </span>
                    </span>
                    <span className="tabular text-xl font-semibold">
                      {stats.oversoldOrders}
                    </span>
                  </Link>
                </CardContent>
              </Card>
            ) : null}

            {stats.pendingOrders > 0 ? (
              <Card>
                <CardContent>
                  <Link
                    className="flex items-center justify-between gap-4"
                    href="/admin/orders?status=pending"
                  >
                    <span className="flex items-center gap-3">
                      <Clock
                        aria-hidden
                        className="size-4"
                        style={{ color: "var(--state-attention)" }}
                      />
                      <Chip tone="attention">{t.overview.pendingOrders}</Chip>
                      <span className="text-muted-foreground">
                        {t.overview.pendingNote}
                      </span>
                    </span>
                    <span className="tabular text-xl font-semibold">
                      {stats.pendingOrders}
                    </span>
                  </Link>
                </CardContent>
              </Card>
            ) : null}

            {/* Stock below a SKU's own minimum order quantity. Nobody can buy
                it, which a plain "in stock" number would hide. */}
            {lowStock.length > 0 ? (
              <Card>
                <CardContent>
                  <div className="mb-3 flex items-center gap-3">
                    <PackageMinus
                      aria-hidden
                      className="size-4"
                      style={{ color: "var(--state-attention)" }}
                    />
                    <Chip tone="attention">{t.overview.belowMoq}</Chip>
                    <span className="text-muted-foreground">
                      {t.overview.belowMoqNote}
                    </span>
                  </div>
                  <ul className="grid gap-1.5 text-sm">
                    {lowStock.slice(0, 8).map((variant) => (
                      <li
                        className="flex items-center justify-between border-t pt-1.5"
                        key={variant.sku}
                      >
                        <span>{variant.sku}</span>
                        <span className="tabular text-muted-foreground">
                          {variant.stock} / {t.products.moq} {variant.moq}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}
          </div>
        )}
      </section>

      <section className="mb-10">
        <Card>
          <CardContent className="grid gap-8 sm:grid-cols-3">
            <Figure label={t.overview.activeProducts} value={stats.activeProducts} />
            <Figure label={t.customers.title} value={stats.customerCount} />
            <Figure
              label={t.overview.ratesUpdated}
              value={
                <span className="text-base">
                  {lastFetched ? formatAdminDate(lastFetched, locale) : t.overview.never}
                </span>
              }
            />
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="mb-4 text-base font-semibold tracking-tight">
          {t.overview.revenue}
        </h2>
        <Card>
          <CardContent>
            {revenue.length === 0 ? (
              <p className="text-muted-foreground">{t.overview.noRevenue}</p>
            ) : (
              <div className="grid gap-8 sm:grid-cols-3">
                {/* One figure per currency. Adding USD to EUR produces a number
                    that means nothing, so the interface never offers a total. */}
                {revenue.map(([currency, minor]) => (
                  <Figure
                    key={currency}
                    label={currency}
                    value={formatMoney(minor, currency as Currency, "en")}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </>
  );
}
