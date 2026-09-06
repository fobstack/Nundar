import Link from "next/link";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Currency } from "@/config/currency";
import { getDb } from "@/db/client";
import { listCustomers } from "@/lib/admin/customers";
import { formatAdminDate } from "@/lib/admin/i18n";
import { getAdminT } from "@/lib/admin/locale";
import { requireAdmin } from "@/lib/auth/guard";
import { formatMoney } from "@/lib/money";
import { PageHead } from "../../_components/ui";

export default async function AdminCustomersPage() {
  await requireAdmin();
  const { locale, t } = await getAdminT();
  const customers = await listCustomers(getDb());

  return (
    <>
      <PageHead title={t.customers.title} />

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.customers.email}</TableHead>
              <TableHead className="text-right">{t.customers.orders}</TableHead>
              <TableHead className="text-right">{t.customers.spent}</TableHead>
              <TableHead>{t.customers.joined}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.length === 0 ? (
              <TableRow>
                <TableCell
                  className="h-24 text-center text-muted-foreground"
                  colSpan={4}
                >
                  {t.customers.empty}
                </TableCell>
              </TableRow>
            ) : (
              customers.map((customer) => {
                const spent = Object.entries(customer.spentByCurrency);

                return (
                  <TableRow key={customer.id}>
                    <TableCell>
                      <Link
                        className="font-medium text-primary hover:underline"
                        href={`/admin/customers/${customer.id}`}
                      >
                        {customer.email}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {customer.orderCount}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {/* One figure per currency, stacked. Adding USD to EUR
                          produces a number that means nothing, so the interface
                          never offers a total. */}
                      {spent.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="grid gap-0.5">
                          {spent.map(([currency, minor]) => (
                            <span key={currency}>
                              {formatMoney(minor, currency as Currency, "en")}
                            </span>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatAdminDate(customer.createdAt, locale)}
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
