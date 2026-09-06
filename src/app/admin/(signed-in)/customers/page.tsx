import Link from "next/link";
import type { Currency } from "@/config/currency";
import { getDb } from "@/db/client";
import { listCustomers } from "@/lib/admin/customers";
import { formatAdminDate } from "@/lib/admin/i18n";
import { getAdminT } from "@/lib/admin/locale";
import { requireAdmin } from "@/lib/auth/guard";
import { formatMoney } from "@/lib/money";
import { Card, PageHead, TableEmpty } from "../../_components/ui";

export default async function AdminCustomersPage() {
  await requireAdmin();
  const { locale, t } = await getAdminT();
  const customers = await listCustomers(getDb());

  return (
    <>
      <PageHead title={t.customers.title} />

      <Card padded={false}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t.customers.email}</th>
              <th className="num">{t.customers.orders}</th>
              <th className="num">{t.customers.spent}</th>
              <th>{t.customers.joined}</th>
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 ? (
              <TableEmpty colSpan={4}>{t.customers.empty}</TableEmpty>
            ) : (
              customers.map((customer) => {
                const spent = Object.entries(customer.spentByCurrency);

                return (
                  <tr key={customer.id}>
                    <td>
                      <Link href={`/admin/customers/${customer.id}`}>
                        {customer.email}
                      </Link>
                    </td>
                    <td className="num">{customer.orderCount}</td>
                    <td className="num">
                      {/* One figure per currency, stacked. Adding USD to EUR
                          produces a number that means nothing, so the interface
                          never offers a total. */}
                      {spent.length === 0 ? (
                        <span style={{ color: "var(--a-ink-3)" }}>—</span>
                      ) : (
                        <div style={{ display: "grid", gap: 2 }}>
                          {spent.map(([currency, minor]) => (
                            <span key={currency}>
                              {formatMoney(minor, currency as Currency, "en")}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td style={{ color: "var(--a-ink-3)" }}>
                      {formatAdminDate(customer.createdAt, locale)}
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
