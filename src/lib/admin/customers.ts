import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";

export type CustomerSummary = {
  id: string;
  email: string;
  createdAt: number;
  orderCount: number;
  /** Total across paid orders, grouped by currency — amounts in different currencies do not add up */
  spentByCurrency: Record<string, number>;
};

/**
 * The customer list.
 *
 * Lifetime spend comes back grouped by currency rather than as one total.
 * Adding a USD amount to a EUR amount produces a number that means nothing, and
 * showing it would only mislead whoever is making decisions from it.
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
      // Count only orders that were actually paid; pending and cancelled are not spend
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
  /** Paid revenue, grouped by currency */
  revenueByCurrency: Record<string, number>;
  customerCount: number;
  lowStockVariants: { sku: string; stock: number; moq: number }[];
};

/** Dashboard statistics. Low stock is measured against MOQ rather than a fixed
 * threshold: a SKU with a minimum order of 50 is already unsellable at 40. */
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
    // Stock below the minimum order quantity means this SKU cannot be ordered at all
    lowStockVariants: variants.filter((v) => v.stock < v.moq),
  };
}
