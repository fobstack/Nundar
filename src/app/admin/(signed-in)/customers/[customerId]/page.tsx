import Link from "next/link";
import { notFound } from "next/navigation";
import type { Currency } from "@/config/currency";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/guard";
import { getCustomer } from "@/lib/admin/customers";
import { formatAdminDate } from "@/lib/admin/i18n";
import { getAdminT } from "@/lib/admin/locale";
import { formatMoney } from "@/lib/money";

export default async function AdminCustomerPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  await requireAdmin();
  const { locale, t } = await getAdminT();
  const { customerId } = await params;

  const customer = await getCustomer(getDb(), customerId);
  if (!customer) {
    notFound();
  }

  return (
    <>
      <Link href="/admin/customers" className="text-sm underline underline-offset-4">
        ← {t.customers.title}
      </Link>

      <h1 className="mt-4 text-xl font-semibold">{customer.email}</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {t.customers.joined} {formatAdminDate(customer.createdAt, locale)}
        {customer.defaultLocale ? ` · ${customer.defaultLocale}` : ""}
      </p>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-neutral-500">
          {t.customers.addresses}
        </h2>
        {customer.addresses.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-400">{t.common.none}</p>
        ) : (
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            {customer.addresses.map((address) => (
              <address
                key={address.id}
                className="rounded-xl border bg-card p-5" style={{ fontStyle: "normal" }}
              >
                <div className="font-medium">{address.recipient}</div>
                <div className="mt-1 text-neutral-600">
                  {address.line1}
                  {address.line2 ? <br /> : null}
                  {address.line2}
                  <br />
                  {address.city} {address.postalCode}
                  <br />
                  {address.country}
                </div>
              </address>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-neutral-500">
          {t.customers.orderHistory}
        </h2>
        <table className="w-full border-collapse text-sm">
          <tbody>
            {customer.orders.map((order) => (
              <tr key={order.id} >
                <td>
                  <Link
                    href={`/admin/orders/${order.orderNo}`}
                    className="font-mono text-xs underline underline-offset-4"
                  >
                    {order.orderNo}
                  </Link>
                </td>
                <td>{order.status}</td>
                <td>
                  {formatMoney(order.totalMinor, order.currency as Currency, "en")}
                </td>
                <td>
                  {formatAdminDate(order.createdAt, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
