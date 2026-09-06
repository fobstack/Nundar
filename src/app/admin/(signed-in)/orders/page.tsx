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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Currency } from "@/config/currency";
import type { Locale } from "@/config/locales";
import { getDb } from "@/db/client";
import { formatAdminDate } from "@/lib/admin/i18n";
import { getAdminT } from "@/lib/admin/locale";
import { requireAdmin } from "@/lib/auth/guard";
import { formatMoney } from "@/lib/money";
import { listOrders } from "@/lib/orders/admin";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/orders/state";
import { OrderStatusChip, PageHead } from "../../_components/ui";

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

  return (
    <>
      <PageHead title={t.orders.title} />

      {/* One control with a current selection, rather than a row of underlined
          links: these are filters on a single list. */}
      <Tabs className="mb-6" value={filter?.status ?? "all"}>
        <TabsList>
          <TabsTrigger render={<Link href="/admin/orders" />} value="all">
            {t.common.all}
          </TabsTrigger>
          {ORDER_STATUSES.map((value) => (
            <TabsTrigger
              key={value}
              render={<Link href={`/admin/orders?status=${value}`} />}
              value={value}
            >
              {value}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.orders.order}</TableHead>
              <TableHead>{t.orders.status}</TableHead>
              <TableHead className="text-right">{t.orders.total}</TableHead>
              <TableHead>{t.orders.locale}</TableHead>
              <TableHead>{t.orders.placed}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 ? (
              <TableRow>
                <TableCell
                  className="h-24 text-center text-muted-foreground"
                  colSpan={5}
                >
                  {t.orders.empty}
                </TableCell>
              </TableRow>
            ) : (
              orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>
                    <Link
                      className="font-medium text-primary hover:underline"
                      href={`/admin/orders/${order.orderNo}`}
                    >
                      {order.orderNo}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <OrderStatusChip status={order.status} />
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {formatMoney(
                      order.totalMinor,
                      order.currency as Currency,
                      order.locale as Locale,
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{order.locale}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatAdminDate(order.createdAt, locale)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
