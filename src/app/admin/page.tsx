import Link from "next/link";
import type { Currency } from "@/config/currency";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/guard";
import { getAdminT } from "@/lib/admin/locale";
import { formatAdminDate } from "@/lib/admin/i18n";
import { getDashboardStats } from "@/lib/admin/customers";
import { formatMoney } from "@/lib/money";
import * as schema from "@/db/schema";

const card = "rounded border border-neutral-200 bg-white p-4";

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

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t.overview.title}</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {t.overview.signedInAs} {session.userId} ({session.role})
      </p>

      {/* What needs doing comes first: people open the admin to work, not to look
          at numbers */}
      {stats.oversoldOrders > 0 ? (
        <p className="mt-6 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <Link href="/admin/orders?status=oversold" className="underline">
            {stats.oversoldOrders} × {t.orders.oversoldWarning}
          </Link>
        </p>
      ) : null}

      {stats.lowStockVariants.length > 0 ? (
        <div className="mt-4 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">
            {stats.lowStockVariants.length} SKU: stock below its own MOQ
          </p>
          <ul className="mt-2 space-y-1 font-mono text-xs">
            {stats.lowStockVariants.slice(0, 8).map((variant) => (
              <li key={variant.sku}>
                {variant.sku} — {variant.stock} / MOQ {variant.moq}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <dl className="mt-8 grid gap-4 sm:grid-cols-4">
        <div className={card}>
          <dt className="text-sm text-neutral-500">{t.overview.activeProducts}</dt>
          <dd className="mt-1 text-2xl font-semibold">{stats.activeProducts}</dd>
        </div>
        <div className={card}>
          <dt className="text-sm text-neutral-500">{t.overview.pendingOrders}</dt>
          <dd className="mt-1 text-2xl font-semibold">{stats.pendingOrders}</dd>
        </div>
        <div className={card}>
          <dt className="text-sm text-neutral-500">{t.customers.title}</dt>
          <dd className="mt-1 text-2xl font-semibold">{stats.customerCount}</dd>
        </div>
        <div className={card}>
          <dt className="text-sm text-neutral-500">{t.overview.ratesUpdated}</dt>
          <dd className="mt-1 text-sm">
            {lastFetched
              ? formatAdminDate(lastFetched, locale)
              : t.overview.never}
          </dd>
        </div>
      </dl>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-neutral-500">
          {t.overview.revenue}
        </h2>
        {revenue.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-400">—</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-4">
            {/* Shown per currency: a sum across currencies means nothing */}
            {revenue.map(([currency, minor]) => (
              <div key={currency} className={card}>
                <div className="text-xs uppercase tracking-wide text-neutral-500">
                  {currency}
                </div>
                <div className="mt-1 text-xl font-semibold">
                  {formatMoney(minor, currency as Currency, "en")}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
