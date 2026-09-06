import Link from "next/link";
import type { Currency } from "@/config/currency";
import type { Locale } from "@/config/locales";
import { getDb } from "@/db/client";
import { formatAdminDate } from "@/lib/admin/i18n";
import { getAdminT } from "@/lib/admin/locale";
import { requireAdmin } from "@/lib/auth/guard";
import { formatMoney } from "@/lib/money";
import { listOrders } from "@/lib/orders/admin";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/orders/state";
import { Card, OrderStatusChip, PageHead, TableEmpty } from "../../_components/ui";

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  const { locale, t } = await getAdminT();
  const { status } = await searchParams;

  const filter = ORDER_STATUSES.includes(status as OrderStatus)
    ? { status: status as OrderStatus }
    : undefined;

  const orders = await listOrders(getDb(), filter);

  const tabs: { key: string | undefined; label: string; href: string }[] = [
    { key: undefined, label: t.common.all, href: "/admin/orders" },
    ...ORDER_STATUSES.map((value) => ({
      key: value,
      label: value,
      href: `/admin/orders?status=${value}`,
    })),
  ];

  return (
    <>
      <PageHead title={t.orders.title} />

      {/* Segmented control rather than a row of underlined links: these are
          filters on one list, and they should look like one control with a
          current selection. */}
      <nav
        style={{
          background: "var(--a-sunken)",
          borderRadius: "var(--a-radius)",
          display: "inline-flex",
          flexWrap: "wrap",
          gap: 2,
          marginBottom: "var(--a-6)",
          padding: 3,
        }}
      >
        {tabs.map((tab) => {
          const current = filter?.status === tab.key;
          return (
            <Link
              aria-current={current ? "page" : undefined}
              href={tab.href}
              key={tab.label}
              style={{
                background: current ? "var(--a-surface)" : "transparent",
                borderRadius: "var(--a-radius-sm)",
                boxShadow: current ? "0 1px 2px rgba(27,33,41,.12)" : undefined,
                color: current ? "var(--a-ink)" : "var(--a-ink-2)",
                fontSize: "var(--a-text-sm)",
                fontWeight: current ? 600 : 500,
                padding: "5px 11px",
              }}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <Card padded={false}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t.orders.order}</th>
              <th>{t.orders.status}</th>
              <th className="num">{t.orders.total}</th>
              <th>{t.orders.locale}</th>
              <th>{t.orders.placed}</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <TableEmpty colSpan={5}>{t.orders.empty}</TableEmpty>
            ) : (
              orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <Link href={`/admin/orders/${order.orderNo}`}>{order.orderNo}</Link>
                  </td>
                  <td>
                    <OrderStatusChip status={order.status} />
                  </td>
                  <td className="num">
                    {formatMoney(
                      order.totalMinor,
                      order.currency as Currency,
                      order.locale as Locale,
                    )}
                  </td>
                  <td style={{ color: "var(--a-ink-2)" }}>{order.locale}</td>
                  <td style={{ color: "var(--a-ink-3)" }}>
                    {formatAdminDate(order.createdAt, locale)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
