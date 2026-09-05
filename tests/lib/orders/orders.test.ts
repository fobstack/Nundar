import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import * as schema from "@/db/schema";
import { createPendingOrder, markOrderPaid } from "@/lib/orders/orders";
import { priceCart } from "@/lib/cart/pricing";
import { seedDatabase } from "@/scripts/seed";

const THREADED = "seed-variant-dn50-threaded";

const ADDRESS = {
  recipient: "Jane Buyer",
  line1: "1 Harbour Road",
  city: "Aberdeen",
  postalCode: "AB11 5RY",
  country: "GB",
};

async function pricedCart(quantity = 10) {
  const result = await priceCart(
    createDb(env.DB),
    [{ variantId: THREADED, quantity }],
    "en",
    "USD",
  );
  if (!result.ok) {
    throw new Error("fixture cart should price cleanly");
  }
  return result;
}

async function orderById(id: string) {
  const [row] = await createDb(env.DB)
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, id));
  return row;
}

async function stockOf(variantId: string) {
  const [row] = await createDb(env.DB)
    .select()
    .from(schema.productVariants)
    .where(eq(schema.productVariants.id, variantId));
  return row.stock;
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM inventory_adjustments");
  await env.DB.exec("DELETE FROM stripe_events");
  await env.DB.exec("DELETE FROM order_items");
  await env.DB.exec("DELETE FROM orders");
  await env.DB.exec("DELETE FROM variant_prices");
  await env.DB.exec("DELETE FROM product_variants");
  await env.DB.exec("DELETE FROM product_use_cases");
  await env.DB.exec("DELETE FROM product_features");
  await env.DB.exec("DELETE FROM product_translations");
  await env.DB.exec("DELETE FROM products");
  await seedDatabase(createDb(env.DB));
});

describe("createPendingOrder", () => {
  it("creates the order in pending with a readable order number", async () => {
    const cart = await pricedCart();
    const order = await createPendingOrder(createDb(env.DB), {
      cart,
      locale: "en",
      shippingAddress: ADDRESS,
      customerId: null,
    });

    const row = await orderById(order.id);
    expect(row.status).toBe("pending");
    expect(row.orderNo).toMatch(/^ND-/);
    expect(row.totalMinor).toBe(99_000);
    expect(row.currency).toBe("USD");
  });

  it("snapshots SKU, name and unit price on each line", async () => {
    const cart = await pricedCart();
    const order = await createPendingOrder(createDb(env.DB), {
      cart,
      locale: "en",
      shippingAddress: ADDRESS,
      customerId: null,
    });

    const [item] = await createDb(env.DB)
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, order.id));

    expect(item.skuSnapshot).toBe("BV-316L-DN50-NPT");
    expect(item.nameSnapshot).toBe("Stainless Steel Ball Valve DN50");
    expect(item.unitPriceMinor).toBe(9900);
  });

  it("does not touch stock — that happens only after payment", async () => {
    const before = await stockOf(THREADED);
    const cart = await pricedCart();

    await createPendingOrder(createDb(env.DB), {
      cart,
      locale: "en",
      shippingAddress: ADDRESS,
      customerId: null,
    });

    expect(await stockOf(THREADED)).toBe(before);
  });

  it("records the locale so notification emails go out in the buyer's language", async () => {
    const cart = await pricedCart();
    const order = await createPendingOrder(createDb(env.DB), {
      cart,
      locale: "de",
      shippingAddress: ADDRESS,
      customerId: null,
    });

    expect((await orderById(order.id)).locale).toBe("de");
  });
});

describe("markOrderPaid", () => {
  async function pendingOrder() {
    const cart = await pricedCart();
    return createPendingOrder(createDb(env.DB), {
      cart,
      locale: "en",
      shippingAddress: ADDRESS,
      customerId: null,
    });
  }

  it("moves the order to paid and decrements stock", async () => {
    const order = await pendingOrder();
    const before = await stockOf(THREADED);

    const result = await markOrderPaid(createDb(env.DB), {
      orderId: order.id,
      eventId: "evt_1",
      paymentIntentId: "pi_1",
    });

    expect(result.status).toBe("paid");
    expect(await stockOf(THREADED)).toBe(before - 10);
  });

  it("writes an inventory adjustment for the audit trail", async () => {
    const order = await pendingOrder();
    await markOrderPaid(createDb(env.DB), {
      orderId: order.id,
      eventId: "evt_1",
      paymentIntentId: "pi_1",
    });

    const adjustments = await createDb(env.DB)
      .select()
      .from(schema.inventoryAdjustments);

    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].delta).toBe(-10);
    expect(adjustments[0].reason).toBe("order_paid");
    expect(adjustments[0].refId).toBe(order.id);
  });

  it("is idempotent: a redelivered event must not decrement stock twice", async () => {
    const order = await pendingOrder();
    const before = await stockOf(THREADED);

    await markOrderPaid(createDb(env.DB), {
      orderId: order.id,
      eventId: "evt_dup",
      paymentIntentId: "pi_1",
    });
    const second = await markOrderPaid(createDb(env.DB), {
      orderId: order.id,
      eventId: "evt_dup",
      paymentIntentId: "pi_1",
    });

    expect(second.status).toBe("paid");
    expect(second.alreadyProcessed).toBe(true);
    expect(await stockOf(THREADED)).toBe(before - 10);
  });

  it("marks the order oversold when stock ran out between order and payment", async () => {
    const order = await pendingOrder();
    await env.DB.exec(
      `UPDATE product_variants SET stock = 2 WHERE id = '${THREADED}'`,
    );

    const result = await markOrderPaid(createDb(env.DB), {
      orderId: order.id,
      eventId: "evt_oversold",
      paymentIntentId: "pi_2",
    });

    expect(result.status).toBe("oversold");
    // 库存不足时绝不能扣成负数
    expect(await stockOf(THREADED)).toBe(2);
  });

  it("records the payment intent id on the order", async () => {
    const order = await pendingOrder();
    await markOrderPaid(createDb(env.DB), {
      orderId: order.id,
      eventId: "evt_1",
      paymentIntentId: "pi_abc",
    });

    expect((await orderById(order.id)).stripePaymentIntentId).toBe("pi_abc");
  });

  it("refuses to pay an order that is already shipped", async () => {
    const order = await pendingOrder();
    await env.DB.exec(
      `UPDATE orders SET status = 'shipped' WHERE id = '${order.id}'`,
    );

    await expect(
      markOrderPaid(createDb(env.DB), {
        orderId: order.id,
        eventId: "evt_late",
        paymentIntentId: "pi_3",
      }),
    ).rejects.toThrow(/transition/i);
  });

  it("throws for an unknown order rather than silently succeeding", async () => {
    await expect(
      markOrderPaid(createDb(env.DB), {
        orderId: "no-such-order",
        eventId: "evt_x",
        paymentIntentId: "pi_x",
      }),
    ).rejects.toThrow(/not found/i);
  });
});
