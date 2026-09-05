import Link from "next/link";
import { notFound } from "next/navigation";
import type { Currency } from "@/config/currency";
import type { Locale } from "@/config/locales";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/guard";
import { formatMoney } from "@/lib/money";
import { getOrder } from "@/lib/orders/admin";
import { canTransition } from "@/lib/orders/state";
import {
  cancelOrderAction,
  deliverOrderAction,
  refundOrderAction,
  shipOrderAction,
} from "./actions";

const button =
  "rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50";

export default async function AdminOrderPage({
  params,
}: {
  params: Promise<{ orderNo: string }>;
}) {
  await requireAdmin();
  const { orderNo } = await params;

  const order = await getOrder(getDb(), orderNo);
  if (!order) {
    notFound();
  }

  const currency = order.currency as Currency;
  const locale = order.locale as Locale;
  const money = (minor: number) => formatMoney(minor, currency, locale);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/admin/orders" className="text-sm underline underline-offset-4">
        ← All orders
      </Link>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-mono text-xl font-semibold">{order.orderNo}</h1>
        <span className="text-sm">{order.status}</span>
      </div>

      {order.status === "oversold" ? (
        <p className="mt-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Payment succeeded but stock had already sold out. Refund this order and
          contact the customer.
        </p>
      ) : null}

      <section className="mt-8">
        <h2 className="text-sm font-medium text-neutral-500">Items</h2>
        <table className="mt-2 w-full border-collapse bg-white text-sm">
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id} className="border-b border-neutral-100">
                <td className="px-3 py-2">
                  {item.nameSnapshot}
                  <span className="ml-2 font-mono text-xs text-neutral-500">
                    {item.skuSnapshot}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">× {item.quantity}</td>
                <td className="px-3 py-2 text-right">
                  {money(item.unitPriceMinor * item.quantity)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="mt-4 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-neutral-500">Subtotal</dt>
            <dd>{money(order.subtotalMinor)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-neutral-500">Shipping</dt>
            <dd>{money(order.shippingMinor)}</dd>
          </div>
          <div className="flex justify-between font-medium">
            <dt>Total</dt>
            <dd>{money(order.totalMinor)}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-neutral-500">Ship to</h2>
        <address className="mt-2 not-italic text-sm">
          {Object.entries(order.shippingAddress).map(([key, value]) => (
            <span key={key} className="block">
              {value}
            </span>
          ))}
        </address>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-neutral-500">Actions</h2>

        {/* The state machine decides which actions exist; never offer a button the
            server will refuse */}
        <div className="mt-3 flex flex-wrap items-end gap-4">
          {canTransition(order.status, "shipped") ? (
            <form action={shipOrderAction} className="flex items-end gap-2">
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="orderNo" value={order.orderNo} />
              <label className="text-sm">
                Tracking number
                <input
                  name="trackingNo"
                  required
                  defaultValue={order.trackingNo ?? ""}
                  className="mt-1 block w-56 rounded border border-neutral-300 px-2 py-1 font-mono text-xs"
                />
              </label>
              <button type="submit" className={button}>
                Mark shipped
              </button>
            </form>
          ) : null}

          {canTransition(order.status, "delivered") ? (
            <form action={deliverOrderAction}>
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="orderNo" value={order.orderNo} />
              <button type="submit" className={button}>
                Mark delivered
              </button>
            </form>
          ) : null}

          {canTransition(order.status, "refunded") ? (
            <form action={refundOrderAction}>
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="orderNo" value={order.orderNo} />
              <button type="submit" className={button}>
                Refund
              </button>
            </form>
          ) : null}

          {canTransition(order.status, "cancelled") ? (
            <form action={cancelOrderAction}>
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="orderNo" value={order.orderNo} />
              <button type="submit" className={button}>
                Cancel
              </button>
            </form>
          ) : null}
        </div>

        {order.trackingNo ? (
          <p className="mt-4 text-sm text-neutral-500">
            Tracking: <span className="font-mono">{order.trackingNo}</span>
          </p>
        ) : null}
      </section>
    </main>
  );
}
