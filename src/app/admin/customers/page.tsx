import Link from "next/link";
import type { Currency } from "@/config/currency";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/guard";
import { listCustomers } from "@/lib/admin/customers";
import { formatAdminDate } from "@/lib/admin/i18n";
import { getAdminT } from "@/lib/admin/locale";
import { formatMoney } from "@/lib/money";

export default async function AdminCustomersPage() {
  await requireAdmin();
  const { locale, t } = await getAdminT();
  const customers = await listCustomers(getDb());

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t.customers.title}</h1>

      {customers.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500">{t.customers.empty}</p>
      ) : (
        <table className="mt-8 w-full border-collapse bg-white text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left">
              <th className="px-3 py-2">{t.customers.email}</th>
              <th className="px-3 py-2">{t.customers.orders}</th>
              <th className="px-3 py-2">{t.customers.spent}</th>
              <th className="px-3 py-2">{t.customers.joined}</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.id} className="border-b border-neutral-100">
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/customers/${customer.id}`}
                    className="underline underline-offset-4"
                  >
                    {customer.email}
                  </Link>
                </td>
                <td className="px-3 py-2">{customer.orderCount}</td>
                <td className="px-3 py-2">
                  {/* One row per currency: merging them would mislead */}
                  {Object.entries(customer.spentByCurrency).length === 0
                    ? "—"
                    : Object.entries(customer.spentByCurrency).map(
                        ([currency, minor]) => (
                          <span key={currency} className="mr-3">
                            {formatMoney(minor, currency as Currency, "en")}
                          </span>
                        ),
                      )}
                </td>
                <td className="px-3 py-2 text-xs text-neutral-500">
                  {formatAdminDate(customer.createdAt, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
