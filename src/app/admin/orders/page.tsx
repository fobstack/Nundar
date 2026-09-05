import Link from "next/link";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/guard";
import { listOrders } from "@/lib/orders/admin";
import { formatMoney } from "@/lib/money";
import type { Currency } from "@/config/currency";
import type { Locale } from "@/config/locales";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/orders/state";

const STATUS_STYLE: Record<OrderStatus, string> = {
  pending: "text-amber-700",
  paid: "text-green-700",
  shipped: "text-blue-700",
  delivered: "text-neutral-600",
  cancelled: "text-neutral-400",
  refunded: "text-neutral-500",
  oversold: "text-red-700",
};

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  const { status } = await searchParams;

  const filter = ORDER_STATUSES.includes(status as OrderStatus)
    ? { status: status as OrderStatus }
    : undefined;

  const orders = await listOrders(getDb(), filter);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>

      <nav className="mt-4 flex flex-wrap gap-3 text-sm">
        <Link
          href="/admin/orders"
          className={filter ? "underline underline-offset-4" : "font-medium"}
        >
          All
        </Link>
        {ORDER_STATUSES.map((value) => (
          <Link
            key={value}
            href={`/admin/orders?status=${value}`}
            className={
              filter?.status === value
                ? "font-medium"
                : "underline underline-offset-4"
            }
          >
            {value}
          </Link>
        ))}
      </nav>

      <table className="mt-6 w-full border-collapse bg-white text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left">
            <th className="px-3 py-2">Order</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Total</th>
            <th className="px-3 py-2">Locale</th>
            <th className="px-3 py-2">Placed</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className="border-b border-neutral-100">
              <td className="px-3 py-2">
                <Link
                  href={`/admin/orders/${order.orderNo}`}
                  className="font-mono text-xs underline underline-offset-4"
                >
                  {order.orderNo}
                </Link>
              </td>
              <td className={`px-3 py-2 ${STATUS_STYLE[order.status]}`}>
                {order.status}
              </td>
              <td className="px-3 py-2">
                {formatMoney(
                  order.totalMinor,
                  order.currency as Currency,
                  order.locale as Locale,
                )}
              </td>
              <td className="px-3 py-2 uppercase">{order.locale}</td>
              <td className="px-3 py-2 text-xs text-neutral-500">
                {new Date(order.createdAt * 1000).toISOString().slice(0, 16).replace("T", " ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {orders.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500">No orders yet.</p>
      ) : null}
    </main>
  );
}
