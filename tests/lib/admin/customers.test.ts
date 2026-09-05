import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import {
  getCustomer,
  getDashboardStats,
  listCustomers,
} from "@/lib/admin/customers";
import { seedDatabase } from "@/scripts/seed";

const NOW = Math.floor(Date.now() / 1000);

async function makeCustomer(id: string, email: string) {
  await env.DB.exec(
    `INSERT INTO customers (id, email, password_hash, created_at) VALUES ('${id}', '${email}', 'x', ${NOW})`,
  );
}

async function makeOrder(
  id: string,
  customerId: string | null,
  status: string,
  currency: string,
  totalMinor: number,
) {
  const customer = customerId ? `'${customerId}'` : "NULL";
  await env.DB.exec(
    `INSERT INTO orders (id, order_no, customer_id, status, currency, subtotal_minor, shipping_minor, tax_minor, total_minor, shipping_address_json, locale, created_at) VALUES ('${id}', 'ND-${id}', ${customer}, '${status}', '${currency}', ${totalMinor}, 0, 0, ${totalMinor}, '{}', 'en', ${NOW})`,
  );
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM order_items");
  await env.DB.exec("DELETE FROM orders");
  await env.DB.exec("DELETE FROM customer_addresses");
  await env.DB.exec("DELETE FROM customers");
  await env.DB.exec("DELETE FROM variant_prices");
  await env.DB.exec("DELETE FROM product_variants");
  await env.DB.exec("DELETE FROM product_use_cases");
  await env.DB.exec("DELETE FROM product_features");
  await env.DB.exec("DELETE FROM product_translations");
  await env.DB.exec("DELETE FROM products");
  await seedDatabase(createDb(env.DB));
});

describe("listCustomers", () => {
  it("returns an empty list when there are no customers", async () => {
    expect(await listCustomers(createDb(env.DB))).toEqual([]);
  });

  it("counts each customer's orders", async () => {
    await makeCustomer("c1", "a@example.com");
    await makeOrder("o1", "c1", "paid", "USD", 10_000);
    await makeOrder("o2", "c1", "shipped", "USD", 5_000);

    const [customer] = await listCustomers(createDb(env.DB));
    expect(customer.orderCount).toBe(2);
  });

  it("keeps spend separated by currency rather than adding them up", async () => {
    await makeCustomer("c1", "a@example.com");
    await makeOrder("o1", "c1", "paid", "USD", 10_000);
    await makeOrder("o2", "c1", "paid", "EUR", 8_000);

    const [customer] = await listCustomers(createDb(env.DB));

    // Adding a USD amount to a EUR one produces a number that means nothing and
    // would only mislead
    expect(customer.spentByCurrency).toEqual({ USD: 10_000, EUR: 8_000 });
  });

  it("excludes unpaid and cancelled orders from spend", async () => {
    await makeCustomer("c1", "a@example.com");
    await makeOrder("o1", "c1", "paid", "USD", 10_000);
    await makeOrder("o2", "c1", "pending", "USD", 99_000);
    await makeOrder("o3", "c1", "cancelled", "USD", 77_000);

    const [customer] = await listCustomers(createDb(env.DB));
    expect(customer.spentByCurrency).toEqual({ USD: 10_000 });
    // The order count still includes everything: cancelled orders need to be visible
    expect(customer.orderCount).toBe(3);
  });

  it("counts a refunded order's value as spent, since it did change hands", async () => {
    await makeCustomer("c1", "a@example.com");
    await makeOrder("o1", "c1", "refunded", "USD", 10_000);

    const [customer] = await listCustomers(createDb(env.DB));
    expect(customer.spentByCurrency).toEqual({ USD: 10_000 });
  });

  it("ignores guest orders that belong to no customer", async () => {
    await makeCustomer("c1", "a@example.com");
    await makeOrder("o1", null, "paid", "USD", 50_000);

    const [customer] = await listCustomers(createDb(env.DB));
    expect(customer.orderCount).toBe(0);
  });
});

describe("getCustomer", () => {
  it("returns null for an unknown id", async () => {
    expect(await getCustomer(createDb(env.DB), "nope")).toBeNull();
  });

  it("returns addresses and order history newest first", async () => {
    await makeCustomer("c1", "a@example.com");
    await env.DB.exec(
      `INSERT INTO customer_addresses (id, customer_id, recipient, line1, city, postal_code, country, is_default) VALUES ('a1', 'c1', 'Jane', '1 Harbour Rd', 'Aberdeen', 'AB11', 'GB', 1)`,
    );
    await makeOrder("o1", "c1", "paid", "USD", 10_000);

    const customer = await getCustomer(createDb(env.DB), "c1");

    expect(customer!.addresses).toHaveLength(1);
    expect(customer!.addresses[0].isDefault).toBe(true);
    expect(customer!.orders).toHaveLength(1);
    expect(customer!.orders[0].orderNo).toBe("ND-o1");
  });
});

describe("getDashboardStats", () => {
  it("counts active products from the seed catalogue", async () => {
    const stats = await getDashboardStats(createDb(env.DB));
    expect(stats.activeProducts).toBeGreaterThan(0);
  });

  it("separates revenue by currency", async () => {
    await makeOrder("o1", null, "paid", "USD", 10_000);
    await makeOrder("o2", null, "delivered", "EUR", 20_000);

    const stats = await getDashboardStats(createDb(env.DB));
    expect(stats.revenueByCurrency).toEqual({ USD: 10_000, EUR: 20_000 });
  });

  it("excludes pending and cancelled orders from revenue", async () => {
    await makeOrder("o1", null, "pending", "USD", 99_000);
    await makeOrder("o2", null, "cancelled", "USD", 88_000);

    const stats = await getDashboardStats(createDb(env.DB));
    expect(stats.revenueByCurrency).toEqual({});
  });

  it("surfaces orders that need attention", async () => {
    await makeOrder("o1", null, "pending", "USD", 1_000);
    await makeOrder("o2", null, "oversold", "USD", 1_000);

    const stats = await getDashboardStats(createDb(env.DB));
    expect(stats.pendingOrders).toBe(1);
    expect(stats.oversoldOrders).toBe(1);
  });

  it("flags a SKU whose stock has fallen below its own MOQ", async () => {
    // MOQ 10 against 4 in stock: nobody can order it, which is what out of stock
    // actually means here
    await env.DB.exec(
      "UPDATE product_variants SET stock = 4 WHERE id = 'seed-variant-dn50-threaded'",
    );

    const stats = await getDashboardStats(createDb(env.DB));
    const flagged = stats.lowStockVariants.find(
      (variant) => variant.sku === "BV-316L-DN50-NPT",
    );

    expect(flagged).toBeDefined();
    expect(flagged!.stock).toBe(4);
    expect(flagged!.moq).toBe(10);
  });

  it("does not flag a SKU with plenty of stock", async () => {
    const stats = await getDashboardStats(createDb(env.DB));
    expect(stats.lowStockVariants).toEqual([]);
  });
});
