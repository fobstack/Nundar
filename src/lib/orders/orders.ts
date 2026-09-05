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

/** Public order number: a date plus a random suffix, so it leaks no order volume */
function newOrderNo(): string {
  const date = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `ND-${date}-${suffix}`;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Create an order awaiting payment.
 *
 * Deliberately does **not** decrement stock. Decrementing at add-to-cart or at
 * order creation lets anyone drain the catalogue with scripted orders. Stock
 * comes off only once payment confirms.
 *
 * The cost of that choice is a small chance of overselling, which
 * markOrderPaid catches with a conditional decrement and routes to a manual
 * refund.
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

  // Snapshot name, SKU and unit price: renaming, repricing or delisting the
  // product later must not alter what a historical order says it was
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
 * Handle a confirmed payment: idempotency, conditional stock decrement, state
 * transition.
 *
 * Stripe redelivers events, so the stripe_events primary key deduplicates
 * first. The decrement is a conditional update (`WHERE stock >= qty`); if any
 * line cannot be satisfied the whole order is marked oversold for a manual
 * refund. Stock is never allowed to go negative.
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

  // Redelivery: report the current status and decrement nothing a second time
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

    // Zero rows changed means the condition failed: someone else bought it first
    const changed = (result as unknown as { meta?: { changes?: number } }).meta
      ?.changes;
    if (changed === 0) {
      oversold = true;
      break;
    }

    decremented.push({ variantId: item.variantId, quantity: item.quantity });
  }

  if (oversold) {
    // Compensate the lines already decremented — D1 has no transaction
    // spanning these statements, so the rollback is manual
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
