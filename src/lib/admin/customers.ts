import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";

export type CustomerSummary = {
  id: string;
  email: string;
  createdAt: number;
  orderCount: number;
  /** 已付款订单的累计金额，按币种分组——不同币种不能相加 */
  spentByCurrency: Record<string, number>;
};

/**
 * 客户列表。
 *
 * 累计消费按币种分组返回而不是求一个总数：把 USD 和 EUR 金额相加得到的数字
 * 没有任何意义，展示出来只会误导运营做决策。
 */
export async function listCustomers(db: Db): Promise<CustomerSummary[]> {
  const rows = await db
    .select()
    .from(schema.customers)
    .orderBy(desc(schema.customers.createdAt));

  if (rows.length === 0) {
    return [];
  }

  const orders = await db
    .select({
      customerId: schema.orders.customerId,
      currency: schema.orders.currency,
      totalMinor: schema.orders.totalMinor,
      status: schema.orders.status,
    })
    .from(schema.orders)
    .where(
      inArray(
        schema.orders.customerId,
        rows.map((row) => row.id),
      ),
    );

  return rows.map((customer) => {
    const own = orders.filter((order) => order.customerId === customer.id);
    const spentByCurrency: Record<string, number> = {};

    for (const order of own) {
      // 只统计真正付过款的单，pending 与 cancelled 不算消费
      if (order.status === "pending" || order.status === "cancelled") {
        continue;
      }
      spentByCurrency[order.currency] =
        (spentByCurrency[order.currency] ?? 0) + order.totalMinor;
    }

    return {
      id: customer.id,
      email: customer.email,
      createdAt: customer.createdAt,
      orderCount: own.length,
      spentByCurrency,
    };
  });
}

export type CustomerDetail = CustomerSummary & {
  defaultLocale: string | null;
  defaultCurrency: string | null;
  addresses: {
    id: string;
    recipient: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string | null;
    postalCode: string;
    country: string;
    phone: string | null;
    isDefault: boolean;
  }[];
  orders: {
    id: string;
    orderNo: string;
    status: string;
    currency: string;
    totalMinor: number;
    createdAt: number;
  }[];
};

export async function getCustomer(
  db: Db,
  customerId: string,
): Promise<CustomerDetail | null> {
  const [customer] = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.id, customerId))
    .limit(1);

  if (!customer) {
    return null;
  }

  const [addresses, orders] = await Promise.all([
    db
      .select()
      .from(schema.customerAddresses)
      .where(eq(schema.customerAddresses.customerId, customerId)),
    db
      .select({
        id: schema.orders.id,
        orderNo: schema.orders.orderNo,
        status: schema.orders.status,
        currency: schema.orders.currency,
        totalMinor: schema.orders.totalMinor,
        createdAt: schema.orders.createdAt,
      })
      .from(schema.orders)
      .where(eq(schema.orders.customerId, customerId))
      .orderBy(desc(schema.orders.createdAt)),
  ]);

  const spentByCurrency: Record<string, number> = {};
  for (const order of orders) {
    if (order.status === "pending" || order.status === "cancelled") {
      continue;
    }
    spentByCurrency[order.currency] =
      (spentByCurrency[order.currency] ?? 0) + order.totalMinor;
  }

  return {
    id: customer.id,
    email: customer.email,
    createdAt: customer.createdAt,
    defaultLocale: customer.defaultLocale,
    defaultCurrency: customer.defaultCurrency,
    orderCount: orders.length,
    spentByCurrency,
    addresses: addresses.map((address) => ({
      ...address,
      isDefault: address.isDefault === 1,
    })),
    orders,
  };
}

export type DashboardStats = {
  activeProducts: number;
  pendingOrders: number;
  oversoldOrders: number;
  /** 已付款营收，按币种分组 */
  revenueByCurrency: Record<string, number>;
  customerCount: number;
  lowStockVariants: { sku: string; stock: number; moq: number }[];
};

/** 概览页的统计。低库存判定用 MOQ 而非固定阈值——起订量 50 的 SKU 剩 40 就已经卖不了了。 */
export async function getDashboardStats(db: Db): Promise<DashboardStats> {
  const [products, orders, customerRows, variants] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(schema.products)
      .where(eq(schema.products.status, "active")),
    db
      .select({
        status: schema.orders.status,
        currency: schema.orders.currency,
        totalMinor: schema.orders.totalMinor,
      })
      .from(schema.orders),
    db.select({ count: sql<number>`count(*)` }).from(schema.customers),
    db
      .select({
        sku: schema.productVariants.sku,
        stock: schema.productVariants.stock,
        moq: schema.productVariants.moq,
      })
      .from(schema.productVariants),
  ]);

  const revenueByCurrency: Record<string, number> = {};
  let pendingOrders = 0;
  let oversoldOrders = 0;

  for (const order of orders) {
    if (order.status === "pending") {
      pendingOrders += 1;
    } else if (order.status === "oversold") {
      oversoldOrders += 1;
    }
    if (["paid", "shipped", "delivered"].includes(order.status)) {
      revenueByCurrency[order.currency] =
        (revenueByCurrency[order.currency] ?? 0) + order.totalMinor;
    }
  }

  return {
    activeProducts: products[0]?.count ?? 0,
    pendingOrders,
    oversoldOrders,
    revenueByCurrency,
    customerCount: customerRows[0]?.count ?? 0,
    // 库存低于起订量 = 这个 SKU 实际已经无法下单
    lowStockVariants: variants.filter((v) => v.stock < v.moq),
  };
}
