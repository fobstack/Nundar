import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { assertTransition, type OrderStatus } from "./state";

export type AdminOrderSummary = {
  id: string;
  orderNo: string;
  status: OrderStatus;
  currency: string;
  totalMinor: number;
  locale: string;
  trackingNo: string | null;
  createdAt: number;
};

export async function listOrders(
  db: Db,
  filter?: { status?: OrderStatus },
): Promise<AdminOrderSummary[]> {
  const base = db
    .select({
      id: schema.orders.id,
      orderNo: schema.orders.orderNo,
      status: schema.orders.status,
      currency: schema.orders.currency,
      totalMinor: schema.orders.totalMinor,
      locale: schema.orders.locale,
      trackingNo: schema.orders.trackingNo,
      createdAt: schema.orders.createdAt,
    })
    .from(schema.orders)
    .orderBy(desc(schema.orders.createdAt));

  const rows = filter?.status
    ? await base.where(eq(schema.orders.status, filter.status))
    : await base;

  return rows.map((row) => ({ ...row, status: row.status as OrderStatus }));
}

export type AdminOrderDetail = AdminOrderSummary & {
  subtotalMinor: number;
  shippingMinor: number;
  taxMinor: number;
  stripePaymentIntentId: string | null;
  shippingAddress: Record<string, string>;
  items: {
    id: string;
    variantId: string;
    skuSnapshot: string;
    nameSnapshot: string;
    unitPriceMinor: number;
    quantity: number;
  }[];
};

export async function getOrder(
  db: Db,
  orderNo: string,
): Promise<AdminOrderDetail | null> {
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.orderNo, orderNo))
    .limit(1);

  if (!order) {
    return null;
  }

  const items = await db
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, order.id));

  let shippingAddress: Record<string, string> = {};
  try {
    shippingAddress = JSON.parse(order.shippingAddressJson) as Record<
      string,
      string
    >;
  } catch {
    // 地址脏数据不该让整个订单详情页打不开
    shippingAddress = {};
  }

  return {
    id: order.id,
    orderNo: order.orderNo,
    status: order.status as OrderStatus,
    currency: order.currency,
    totalMinor: order.totalMinor,
    subtotalMinor: order.subtotalMinor,
    shippingMinor: order.shippingMinor,
    taxMinor: order.taxMinor,
    locale: order.locale,
    trackingNo: order.trackingNo,
    createdAt: order.createdAt,
    stripePaymentIntentId: order.stripePaymentIntentId,
    shippingAddress,
    items,
  };
}

async function currentStatus(db: Db, orderId: string): Promise<OrderStatus> {
  const [order] = await db
    .select({ status: schema.orders.status })
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .limit(1);

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }
  return order.status as OrderStatus;
}

/** 发货：记录物流单号并流转状态 */
export async function shipOrder(
  db: Db,
  orderId: string,
  trackingNo: string,
): Promise<void> {
  const status = await currentStatus(db, orderId);
  assertTransition(status, "shipped");

  const tracking = trackingNo.trim();
  if (!tracking) {
    // 没有单号的"已发货"对客服和客户都没有意义
    throw new Error("Tracking number is required when shipping an order");
  }

  await db
    .update(schema.orders)
    .set({ status: "shipped", trackingNo: tracking })
    .where(eq(schema.orders.id, orderId));
}

export async function markDelivered(db: Db, orderId: string): Promise<void> {
  assertTransition(await currentStatus(db, orderId), "delivered");

  await db
    .update(schema.orders)
    .set({ status: "delivered" })
    .where(eq(schema.orders.id, orderId));
}

export async function cancelOrder(db: Db, orderId: string): Promise<void> {
  assertTransition(await currentStatus(db, orderId), "cancelled");

  await db
    .update(schema.orders)
    .set({ status: "cancelled" })
    .where(eq(schema.orders.id, orderId));
}

/**
 * 退款：状态流转 + 把库存还回去。
 *
 * 只有真正扣过库存的状态（paid 之后）才需要归还；oversold 的单从未扣成，
 * 归还会凭空多出库存，所以按 inventory_adjustments 的实际记录来回滚。
 */
export async function refundOrder(db: Db, orderId: string): Promise<void> {
  assertTransition(await currentStatus(db, orderId), "refunded");

  const adjustments = await db
    .select()
    .from(schema.inventoryAdjustments)
    .where(eq(schema.inventoryAdjustments.refId, orderId));

  const now = Math.floor(Date.now() / 1000);

  for (const adjustment of adjustments) {
    if (adjustment.reason !== "order_paid") {
      continue;
    }

    const restore = -adjustment.delta;

    await db
      .update(schema.productVariants)
      .set({ stock: sql`${schema.productVariants.stock} + ${restore}` })
      .where(eq(schema.productVariants.id, adjustment.variantId));

    await db.insert(schema.inventoryAdjustments).values({
      id: crypto.randomUUID(),
      variantId: adjustment.variantId,
      delta: restore,
      reason: "refund",
      refId: orderId,
      createdAt: now,
    });
  }

  await db
    .update(schema.orders)
    .set({ status: "refunded" })
    .where(eq(schema.orders.id, orderId));
}
