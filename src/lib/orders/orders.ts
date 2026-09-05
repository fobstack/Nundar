import { and, eq, gte, sql } from "drizzle-orm";
import type { Locale } from "@/config/locales";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import type { PricedCart } from "@/lib/cart/pricing";
import { assertTransition, type OrderStatus } from "./state";

export type ShippingAddress = {
  recipient: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
  phone?: string;
};

type SuccessfulCart = Extract<PricedCart, { ok: true }>;

/** 对外可读单号：日期 + 随机段，不暴露订单总量 */
function newOrderNo(): string {
  const date = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `ND-${date}-${suffix}`;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * 创建待支付订单。
 *
 * 刻意**不扣库存**：加购或下单即扣会被恶意刷单占光库存。库存在支付确认后才扣，
 * 代价是极小概率超卖，由 markOrderPaid 的条件扣减兜住并转人工退款。
 */
export async function createPendingOrder(
  db: Db,
  input: {
    cart: SuccessfulCart;
    locale: Locale;
    shippingAddress: ShippingAddress;
    customerId: string | null;
    shippingMinor?: number;
    taxMinor?: number;
  },
): Promise<{ id: string; orderNo: string; totalMinor: number }> {
  const id = crypto.randomUUID();
  const orderNo = newOrderNo();
  const shippingMinor = input.shippingMinor ?? 0;
  const taxMinor = input.taxMinor ?? 0;
  const totalMinor = input.cart.subtotalMinor + shippingMinor + taxMinor;

  await db.insert(schema.orders).values({
    id,
    orderNo,
    customerId: input.customerId,
    status: "pending",
    currency: input.cart.currency,
    subtotalMinor: input.cart.subtotalMinor,
    shippingMinor,
    taxMinor,
    totalMinor,
    shippingAddressJson: JSON.stringify(input.shippingAddress),
    locale: input.locale,
    createdAt: nowSeconds(),
  });

  // 快照商品名、SKU 与单价：商品之后改名改价下架都不影响历史订单
  for (const line of input.cart.lines) {
    await db.insert(schema.orderItems).values({
      id: crypto.randomUUID(),
      orderId: id,
      variantId: line.variantId,
      skuSnapshot: line.sku,
      nameSnapshot: line.name,
      unitPriceMinor: line.unitPriceMinor,
      quantity: line.quantity,
    });
  }

  return { id, orderNo, totalMinor };
}

export type PaymentResult = {
  status: OrderStatus;
  alreadyProcessed: boolean;
};

/**
 * 支付成功后的处理：幂等 + 条件扣减库存 + 状态流转。
 *
 * Stripe 会重投同一事件，所以先用 stripe_events 的主键去重；库存扣减用
 * `WHERE stock >= qty` 的条件更新，任一行扣不动就把整单标记为 oversold
 * 交人工处理并退款，绝不把库存扣成负数。
 */
export async function markOrderPaid(
  db: Db,
  input: { orderId: string; eventId: string; paymentIntentId: string },
): Promise<PaymentResult> {
  const [existingEvent] = await db
    .select()
    .from(schema.stripeEvents)
    .where(eq(schema.stripeEvents.eventId, input.eventId))
    .limit(1);

  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, input.orderId))
    .limit(1);

  if (!order) {
    throw new Error(`Order ${input.orderId} not found`);
  }

  // 重复投递：直接回报当前状态，绝不重复扣库存
  if (existingEvent) {
    return { status: order.status as OrderStatus, alreadyProcessed: true };
  }

  assertTransition(order.status as OrderStatus, "paid");

  const items = await db
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, input.orderId));

  const now = nowSeconds();
  const decremented: { variantId: string; quantity: number }[] = [];
  let oversold = false;

  for (const item of items) {
    const result = await db
      .update(schema.productVariants)
      .set({ stock: sql`${schema.productVariants.stock} - ${item.quantity}` })
      .where(
        and(
          eq(schema.productVariants.id, item.variantId),
          gte(schema.productVariants.stock, item.quantity),
        ),
      );

    // 条件不满足时影响行数为 0，说明这一行库存已被别人买走
    const changed = (result as unknown as { meta?: { changes?: number } }).meta
      ?.changes;
    if (changed === 0) {
      oversold = true;
      break;
    }

    decremented.push({ variantId: item.variantId, quantity: item.quantity });
  }

  if (oversold) {
    // 回滚已扣的行：D1 没有跨语句事务时的补偿写法
    for (const done of decremented) {
      await db
        .update(schema.productVariants)
        .set({ stock: sql`${schema.productVariants.stock} + ${done.quantity}` })
        .where(eq(schema.productVariants.id, done.variantId));
    }

    await db
      .update(schema.orders)
      .set({ status: "oversold", stripePaymentIntentId: input.paymentIntentId })
      .where(eq(schema.orders.id, input.orderId));

    await db.insert(schema.stripeEvents).values({
      eventId: input.eventId,
      type: "payment_intent.succeeded",
      processedAt: now,
    });

    return { status: "oversold", alreadyProcessed: false };
  }

  for (const done of decremented) {
    await db.insert(schema.inventoryAdjustments).values({
      id: crypto.randomUUID(),
      variantId: done.variantId,
      delta: -done.quantity,
      reason: "order_paid",
      refId: input.orderId,
      createdAt: now,
    });
  }

  await db
    .update(schema.orders)
    .set({ status: "paid", stripePaymentIntentId: input.paymentIntentId })
    .where(eq(schema.orders.id, input.orderId));

  await db.insert(schema.stripeEvents).values({
    eventId: input.eventId,
    type: "payment_intent.succeeded",
    processedAt: now,
  });

  return { status: "paid", alreadyProcessed: false };
}
