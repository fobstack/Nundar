import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { productVariants } from "./product";

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    orderNo: text("order_no").notNull(),
    customerId: text("customer_id"),
    /** pending | paid | shipped | delivered | cancelled | refunded | oversold */
    status: text("status").notNull(),
    currency: text("currency").notNull(),
    subtotalMinor: integer("subtotal_minor").notNull(),
    shippingMinor: integer("shipping_minor").notNull().default(0),
    taxMinor: integer("tax_minor").notNull().default(0),
    totalMinor: integer("total_minor").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    shippingAddressJson: text("shipping_address_json").notNull(),
    /** The language the order was placed in, so notifications go out in it */
    locale: text("locale").notNull(),
    trackingNo: text("tracking_no"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("orders_order_no_unique").on(table.orderNo),
    uniqueIndex("orders_payment_intent_unique").on(table.stripePaymentIntentId),
    index("orders_status_idx").on(table.status),
    index("orders_customer_idx").on(table.customerId),
  ],
);

/** Order lines are snapshots: renaming, repricing or delisting a product leaves
 * historical orders untouched. */
export const orderItems = sqliteTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    variantId: text("variant_id").notNull(),
    skuSnapshot: text("sku_snapshot").notNull(),
    nameSnapshot: text("name_snapshot").notNull(),
    unitPriceMinor: integer("unit_price_minor").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (table) => [index("order_items_order_idx").on(table.orderId)],
);

/** Webhook idempotency. Stripe redelivers events, and processing one twice would
 * decrement stock twice. */
export const stripeEvents = sqliteTable("stripe_events", {
  eventId: text("event_id").primaryKey(),
  type: text("type").notNull(),
  processedAt: integer("processed_at").notNull(),
});

export const inventoryAdjustments = sqliteTable(
  "inventory_adjustments",
  {
    id: text("id").primaryKey(),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    /** order_paid | manual | refund | oversold_fix */
    reason: text("reason").notNull(),
    refId: text("ref_id"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("inventory_adjustments_variant_idx").on(table.variantId)],
);
