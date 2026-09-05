import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import * as schema from "@/db/schema";
import { priceCart } from "@/lib/cart/pricing";
import {
  cancelOrder,
  getOrder,
  listOrders,
  markDelivered,
  refundOrder,
  shipOrder,
} from "@/lib/orders/admin";
import { createPendingOrder, markOrderPaid } from "@/lib/orders/orders";
import { seedDatabase } from "@/scripts/seed";

const THREADED = "seed-variant-dn50-threaded";

const ADDRESS = {
  recipient: "Jane Buyer",
  line1: "1 Harbour Road",
  city: "Aberdeen",
  postalCode: "AB11 5RY",
  country: "GB",
};

async function makeOrder(quantity = 10) {
  const cart = await priceCart(
    createDb(env.DB),
    [{ variantId: THREADED, quantity }],
    "en",
    "USD",
  );
  if (!cart.ok) throw new Error("fixture cart should price cleanly");

  return createPendingOrder(createDb(env.DB), {
    cart,
    locale: "en",
    shippingAddress: ADDRESS,
    customerId: null,
  });
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

describe("listOrders", () => {
  it("lists newest first", async () => {
    await makeOrder();
    await makeOrder();

    const orders = await listOrders(createDb(env.DB));
    expect(orders).toHaveLength(2);
    expect(orders[0].createdAt).toBeGreaterThanOrEqual(orders[1].createdAt);
  });

  it("filters by status", async () => {
    const first = await makeOrder();
    await makeOrder();
    await markOrderPaid(createDb(env.DB), {
      orderId: first.id,
      eventId: "evt_1",
      paymentIntentId: "pi_1",
    });

    const paid = await listOrders(createDb(env.DB), { status: "paid" });
    expect(paid).toHaveLength(1);
    expect(paid[0].orderNo).toBe(first.orderNo);
  });
});

describe("getOrder", () => {
  it("returns the order with items and parsed address", async () => {
    const created = await makeOrder();
    const order = await getOrder(createDb(env.DB), created.orderNo);

    expect(order).not.toBeNull();
    expect(order!.items).toHaveLength(1);
    expect(order!.shippingAddress.city).toBe("Aberdeen");
  });

  it("returns null for an unknown order number", async () => {
    expect(await getOrder(createDb(env.DB), "ND-NOPE")).toBeNull();
  });

  it("survives a corrupt stored address", async () => {
    const created = await makeOrder();
    await env.DB.exec(
      `UPDATE orders SET shipping_address_json = 'not json' WHERE id = '${created.id}'`,
    );

    const order = await getOrder(createDb(env.DB), created.orderNo);
    expect(order!.shippingAddress).toEqual({});
  });
});

describe("shipOrder", () => {
  async function paidOrder() {
    const created = await makeOrder();
    await markOrderPaid(createDb(env.DB), {
      orderId: created.id,
      eventId: `evt_${created.id}`,
      paymentIntentId: `pi_${created.id}`,
    });
    return created;
  }

  it("records the tracking number and moves to shipped", async () => {
    const created = await paidOrder();
    await shipOrder(createDb(env.DB), created.id, "TRACK-123");

    const order = await getOrder(createDb(env.DB), created.orderNo);
    expect(order!.status).toBe("shipped");
    expect(order!.trackingNo).toBe("TRACK-123");
  });

  it("refuses to ship without a tracking number", async () => {
    const created = await paidOrder();
    await expect(
      shipOrder(createDb(env.DB), created.id, "   "),
    ).rejects.toThrow(/tracking number/i);
  });

  it("refuses to ship an unpaid order", async () => {
    const created = await makeOrder();
    await expect(
      shipOrder(createDb(env.DB), created.id, "TRACK-123"),
    ).rejects.toThrow(/transition/i);
  });
});

describe("cancelOrder", () => {
  it("cancels a pending order", async () => {
    const created = await makeOrder();
    await cancelOrder(createDb(env.DB), created.id);

    expect((await getOrder(createDb(env.DB), created.orderNo))!.status).toBe(
      "cancelled",
    );
  });

  it("refuses to cancel a paid order", async () => {
    const created = await makeOrder();
    await markOrderPaid(createDb(env.DB), {
      orderId: created.id,
      eventId: "evt_c",
      paymentIntentId: "pi_c",
    });

    await expect(cancelOrder(createDb(env.DB), created.id)).rejects.toThrow(
      /transition/i,
    );
  });
});

describe("refundOrder", () => {
  it("returns the stock that was taken when the order was paid", async () => {
    const before = await stockOf(THREADED);
    const created = await makeOrder();
    await markOrderPaid(createDb(env.DB), {
      orderId: created.id,
      eventId: "evt_r",
      paymentIntentId: "pi_r",
    });
    expect(await stockOf(THREADED)).toBe(before - 10);

    await refundOrder(createDb(env.DB), created.id);

    expect(await stockOf(THREADED)).toBe(before);
    expect((await getOrder(createDb(env.DB), created.orderNo))!.status).toBe(
      "refunded",
    );
  });

  it("writes a refund adjustment for the audit trail", async () => {
    const created = await makeOrder();
    await markOrderPaid(createDb(env.DB), {
      orderId: created.id,
      eventId: "evt_r2",
      paymentIntentId: "pi_r2",
    });
    await refundOrder(createDb(env.DB), created.id);

    const adjustments = await createDb(env.DB)
      .select()
      .from(schema.inventoryAdjustments)
      .where(eq(schema.inventoryAdjustments.refId, created.id));

    expect(adjustments.map((a) => a.reason).sort()).toEqual([
      "order_paid",
      "refund",
    ]);
  });

  it("does not invent stock when refunding an oversold order", async () => {
    const created = await makeOrder();
    await env.DB.exec(
      `UPDATE product_variants SET stock = 1 WHERE id = '${THREADED}'`,
    );
    await markOrderPaid(createDb(env.DB), {
      orderId: created.id,
      eventId: "evt_over",
      paymentIntentId: "pi_over",
    });

    const stockBeforeRefund = await stockOf(THREADED);
    await refundOrder(createDb(env.DB), created.id);

    // 超卖单从未真正扣成库存，退款时不能凭空加回去
    expect(await stockOf(THREADED)).toBe(stockBeforeRefund);
  });

  it("refuses to refund a pending order", async () => {
    const created = await makeOrder();
    await expect(refundOrder(createDb(env.DB), created.id)).rejects.toThrow(
      /transition/i,
    );
  });
});

describe("markDelivered", () => {
  it("moves a shipped order to delivered", async () => {
    const created = await makeOrder();
    await markOrderPaid(createDb(env.DB), {
      orderId: created.id,
      eventId: "evt_d",
      paymentIntentId: "pi_d",
    });
    await shipOrder(createDb(env.DB), created.id, "T-1");
    await markDelivered(createDb(env.DB), created.id);

    expect((await getOrder(createDb(env.DB), created.orderNo))!.status).toBe(
      "delivered",
    );
  });
});
