import Link from "next/link";
import type { Currency } from "@/config/currency";
import * as schema from "@/db/schema";
import { getDb } from "@/db/client";
import { getDashboardStats } from "@/lib/admin/customers";
import { formatAdminDate } from "@/lib/admin/i18n";
import { getAdminT } from "@/lib/admin/locale";
import { requireAdmin } from "@/lib/auth/guard";
import { formatMoney } from "@/lib/money";
import { Card, Chip, Figure, PageHead } from "../_components/ui";

/**
 * The overview.
 *
 * Built around one claim: people open an admin to work, not to read numbers. So
 * the queue of things needing a person comes first and gets the only saturated
 * colour on the page, and the reference figures sit quietly underneath. Four
 * identical stat cards across the top — the reflex layout — would give an
 * oversold order and the customer count the same visual weight, which is
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

      <section style={{ marginBottom: "var(--a-10)" }}>
        <h2 className="admin-section-title">{t.overview.needsYou}</h2>

        {clear ? (
          <Card>
            <div style={{ alignItems: "center", display: "flex", gap: "var(--a-3)" }}>
              <Chip tone="ok">{t.overview.allClear}</Chip>
              <span style={{ color: "var(--a-ink-2)" }}>{t.overview.allClearNote}</span>
            </div>
          </Card>
        ) : (
          <div style={{ display: "grid", gap: "var(--a-3)" }}>
            {/* Paid, unfulfillable, and only a person can resolve it. This is the
                most serious thing the shop can be doing, so it leads. */}
            {stats.oversoldOrders > 0 ? (
              <Card>
                <Link
                  href="/admin/orders?status=oversold"
                  style={{
                    alignItems: "center",
                    display: "flex",
                    gap: "var(--a-4)",
                    justifyContent: "space-between",
                  }}
                >
                  <span style={{ alignItems: "center", display: "flex", gap: "var(--a-3)" }}>
                    <Chip tone="danger">{t.orders.oversoldWarning}</Chip>
                    <span style={{ color: "var(--a-ink-2)" }}>
                      {t.overview.oversoldNote}
                    </span>
                  </span>
                  <span className="figure" style={{ fontSize: "var(--a-text-xl)", fontWeight: 650 }}>
                    {stats.oversoldOrders}
                  </span>
                </Link>
              </Card>
            ) : null}

            {stats.pendingOrders > 0 ? (
              <Card>
                <Link
                  href="/admin/orders?status=pending"
                  style={{
                    alignItems: "center",
                    display: "flex",
                    gap: "var(--a-4)",
                    justifyContent: "space-between",
                  }}
                >
                  <span style={{ alignItems: "center", display: "flex", gap: "var(--a-3)" }}>
                    <Chip tone="attention">{t.overview.pendingOrders}</Chip>
                    <span style={{ color: "var(--a-ink-2)" }}>
                      {t.overview.pendingNote}
                    </span>
                  </span>
                  <span className="figure" style={{ fontSize: "var(--a-text-xl)", fontWeight: 650 }}>
                    {stats.pendingOrders}
                  </span>
                </Link>
              </Card>
            ) : null}

            {/* Stock below a SKU's own minimum order quantity. Nobody can buy it,
                which a plain "in stock" number would hide. */}
            {lowStock.length > 0 ? (
              <Card>
                <div
                  style={{
                    alignItems: "center",
                    display: "flex",
                    gap: "var(--a-3)",
                    marginBottom: "var(--a-3)",
                  }}
                >
                  <Chip tone="attention">{t.overview.belowMoq}</Chip>
                  <span style={{ color: "var(--a-ink-2)" }}>{t.overview.belowMoqNote}</span>
                </div>
                <table className="admin-table">
                  <tbody>
                    {lowStock.slice(0, 8).map((variant) => (
                      <tr key={variant.sku}>
                        <td>{variant.sku}</td>
                        <td className="num">{variant.stock}</td>
                        <td className="num" style={{ color: "var(--a-ink-3)" }}>
                          {t.products.moq} {variant.moq}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ) : null}
          </div>
        )}
      </section>

      <section style={{ marginBottom: "var(--a-10)" }}>
        <Card>
          <div
            style={{
              display: "grid",
              gap: "var(--a-8)",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            }}
          >
            <Figure label={t.overview.activeProducts} value={stats.activeProducts} />
            <Figure label={t.customers.title} value={stats.customerCount} />
            <Figure
              label={t.overview.ratesUpdated}
              value={
                <span style={{ fontSize: "var(--a-text-lg)" }}>
                  {lastFetched ? formatAdminDate(lastFetched, locale) : t.overview.never}
                </span>
              }
            />
          </div>
        </Card>
      </section>

      <section>
        <h2 className="admin-section-title">{t.overview.revenue}</h2>
        <Card>
          {revenue.length === 0 ? (
            <p style={{ color: "var(--a-ink-3)", margin: 0 }}>{t.overview.noRevenue}</p>
          ) : (
            <div
              style={{
                display: "grid",
                gap: "var(--a-8)",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              }}
            >
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
        </Card>
      </section>
    </>
  );
}
