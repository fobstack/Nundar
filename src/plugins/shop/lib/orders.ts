/**
 * Orders: placing one, reading one, and confirming its payment.
 *
 * Three rules shape everything here.
 *
 * **Stock comes off when payment is confirmed, never before.** Taking it at
 * add-to-cart or when the order is placed would let anyone empty the
 * catalogue with scripted orders that are never paid. The price of that
 * choice is a small chance that two buyers pay for the last unit; the second
 * payment is caught below and the order marked `oversold` for a refund.
 *
 * **A payment is one D1 batch.** Recording the event, taking the stock,
 * writing the ledger and moving the order to `paid` commit together or not at
 * all. What makes that safe is the `CHECK (stock >= 0)` on the variant: a
 * decrement that would oversell fails its statement, and a failed statement
 * rolls the whole batch back (`test/shop/schema.test.ts` proves both halves).
 * There is no compensation code, because there is never anything to undo.
 *
 * **What follows a payment is written with it.** The same batch puts a row
 * in the outbox (`outbox.ts`). The buyer's email is sent from that row, never
 * from the value this module returns: a return value is lost whenever the
 * Worker stops, or the answer to the batch does not come back.
 */

import { changedProductGroups, type StockRow } from './availability.js';
import type { PricedCart } from './cart-pricing.js';
import { type Currency, isCurrency } from './currency.js';
import { sumMinor } from './money.js';
import { ORDER_STILL_IN_STATUS, type SqlCondition } from './order-guard.js';
import {
  assertTransition,
  canTransition,
  type OrderStatus,
} from './order-state.js';
import { orderChangedOutbox, paymentRefusedOutbox } from './outbox.js';

/** Thrown by anything asked to act on an order that does not exist. */
export class OrderNotFoundError extends Error {
  readonly orderId: string;

  constructor(orderId: string) {
    super(`Order ${orderId} not found`);
    this.name = 'OrderNotFoundError';
    this.orderId = orderId;
  }
}

export interface ShippingAddress {
  readonly recipient: string;
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  readonly state?: string;
  readonly postalCode: string;
  /** ISO 3166-1 alpha-2. */
  readonly country: string;
  readonly phone?: string;
}

type SuccessfulCart = Extract<PricedCart, { ok: true }>;

/** The Stripe event that confirms a payment. */
export const PAYMENT_EVENT_TYPE = 'payment_intent.succeeded';

/**
 * Crockford's base 32: no I, L, O or U, so a number read over the phone or
 * copied from paper is not mistaken for another.
 */
const ORDER_NO_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * The number a buyer sees: the date and a random suffix, so it says nothing
 * about how many orders the shop takes.
 *
 * Eight characters are forty bits. Six hexadecimal ones, as before, are
 * twenty-four: at a thousand orders a day two of them would collide about
 * once a month, and a collision is a checkout that fails.
 */
function newOrderNo(now: Date): string {
  const date = now.toISOString().slice(2, 10).replace(/-/g, '');
  let suffix = '';
  for (const byte of crypto.getRandomValues(new Uint8Array(8))) {
    // 256 is a multiple of 32, so the low five bits are uniform.
    suffix += ORDER_NO_ALPHABET.charAt(byte & 31);
  }
  return `ND-${date}-${suffix}`;
}

/**
 * Places an order that is waiting for payment.
 *
 * The order and its lines are written in one batch, and the lines travel as
 * a single JSON parameter, so the cost is one round trip however long the
 * cart is. Each line is a snapshot of the SKU, the name and the unit price at
 * this moment.
 *
 * Stock is not touched (see the note at the top of this file).
 */
export async function createPendingOrder(
  db: D1Database,
  input: {
    readonly cart: SuccessfulCart;
    readonly locale: string;
    readonly email: string;
    readonly shippingAddress: ShippingAddress;
    readonly shippingMinor?: number;
    readonly taxMinor?: number;
    readonly now: Date;
  },
): Promise<{ id: string; orderNo: string; totalMinor: number }> {
  const { cart } = input;
  if (cart.lines.length === 0) {
    throw new Error('An order needs at least one line');
  }

  for (const line of cart.lines) {
    // Checked one by one: 99.5 times 10 is a whole number, and a check on
    // the product alone would let the half through into a stored price.
    if (
      !Number.isInteger(line.unitPriceMinor) ||
      line.unitPriceMinor < 0 ||
      !Number.isInteger(line.quantity) ||
      line.quantity <= 0
    ) {
      throw new Error(
        `Line ${line.variantId} needs a whole, non-negative unit price in minor units and a whole, positive quantity`,
      );
    }
  }

  const id = crypto.randomUUID();
  const orderNo = newOrderNo(input.now);
  const shippingMinor = input.shippingMinor ?? 0;
  const taxMinor = input.taxMinor ?? 0;
  // Added up from the lines being written, so an order's subtotal can never
  // disagree with its own lines.
  const subtotalMinor = sumMinor(
    cart.lines.map((line) => line.unitPriceMinor * line.quantity),
  );
  const totalMinor = sumMinor([subtotalMinor, shippingMinor, taxMinor]);
  const nowIso = input.now.toISOString();

  await db.batch([
    db
      .prepare(
        `INSERT INTO p_shop_order
           (id, order_no, status, currency, subtotal_minor, shipping_minor,
            tax_minor, total_minor, email, shipping_address, locale,
            created_at, updated_at)
         VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        orderNo,
        cart.currency,
        subtotalMinor,
        shippingMinor,
        taxMinor,
        totalMinor,
        input.email,
        JSON.stringify(input.shippingAddress),
        input.locale,
        nowIso,
        nowIso,
      ),
    db
      .prepare(
        `INSERT INTO p_shop_order_line
           (id, order_id, variant_id, sku_snapshot, name_snapshot,
            unit_price_minor, quantity)
         SELECT ? || ':' || json_extract(value, '$.v'), ?,
                json_extract(value, '$.v'), json_extract(value, '$.s'),
                json_extract(value, '$.n'), json_extract(value, '$.p'),
                json_extract(value, '$.q')
         FROM json_each(?)`,
      )
      .bind(
        id,
        id,
        JSON.stringify(
          cart.lines.map((line) => ({
            v: line.variantId,
            s: line.sku,
            n: line.name,
            p: line.unitPriceMinor,
            q: line.quantity,
          })),
        ),
      ),
  ]);

  return { id, orderNo, totalMinor };
}

export interface OrderLine {
  readonly variantId: string;
  readonly sku: string;
  readonly name: string;
  readonly unitPriceMinor: number;
  readonly quantity: number;
}

export interface OrderDetail {
  readonly id: string;
  readonly orderNo: string;
  readonly status: OrderStatus;
  readonly currency: Currency;
  readonly subtotalMinor: number;
  readonly shippingMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
  readonly email: string;
  /** Empty when the stored address cannot be read. */
  readonly shippingAddress: Partial<ShippingAddress>;
  readonly locale: string;
  readonly trackingNo: string | null;
  readonly stripePaymentIntentId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lines: readonly OrderLine[];
  /**
   * Business days within which the whole order can leave, going by the
   * variants' lead times as they stand now; null unless every line states one.
   */
  readonly leadTimeDaysMax: number | null;
}

interface OrderRow {
  id: string;
  order_no: string;
  status: string;
  currency: string;
  subtotal_minor: number;
  shipping_minor: number;
  tax_minor: number;
  total_minor: number;
  email: string;
  shipping_address: string;
  locale: string;
  tracking_no: string | null;
  stripe_payment_intent_id: string | null;
  created_at: string;
  updated_at: string;
}

interface LineRow {
  variant_id: string;
  sku_snapshot: string;
  name_snapshot: string;
  unit_price_minor: number;
  quantity: number;
}

interface LeadTimeRow {
  lines: number;
  stated: number;
  max_days: number | null;
}

function parseAddress(json: string): Partial<ShippingAddress> {
  try {
    const value: unknown = JSON.parse(json);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Partial<ShippingAddress>;
    }
  } catch {
    // A malformed address must not make the order impossible to open.
  }
  return {};
}

/** Reads one order with its lines, by id or by the number the buyer holds. */
export async function getOrder(
  db: D1Database,
  by: { readonly id: string } | { readonly orderNo: string },
): Promise<OrderDetail | null> {
  // One of two literals, never anything a caller supplied.
  const column = 'id' in by ? 'id' : 'order_no';
  const key = 'id' in by ? by.id : by.orderNo;
  const orderId = `(SELECT id FROM p_shop_order WHERE ${column} = ?)`;

  const [orderResult, lineResult, leadTimeResult] = await db.batch<
    OrderRow | LineRow | LeadTimeRow
  >([
    db
      .prepare(
        `SELECT id, order_no, status, currency, subtotal_minor, shipping_minor,
                tax_minor, total_minor, email, shipping_address, locale,
                tracking_no, stripe_payment_intent_id, created_at, updated_at
         FROM p_shop_order WHERE ${column} = ?`,
      )
      .bind(key),
    db
      .prepare(
        `SELECT variant_id, sku_snapshot, name_snapshot, unit_price_minor,
                quantity
         FROM p_shop_order_line WHERE order_id = ${orderId}
         ORDER BY variant_id`,
      )
      .bind(key),
    db
      .prepare(
        `SELECT COUNT(*) AS lines, COUNT(v.lead_time_max) AS stated,
                MAX(v.lead_time_max) AS max_days
         FROM p_shop_order_line AS l
         LEFT JOIN p_shop_variant AS v ON v.id = l.variant_id
         WHERE l.order_id = ${orderId}`,
      )
      .bind(key),
  ]);

  const row = (orderResult?.results ?? [])[0] as OrderRow | undefined;
  if (row === undefined) {
    return null;
  }
  if (!isCurrency(row.currency)) {
    // Formatting money in a currency the shop does not know would print a
    // wrong amount. Better that the order cannot be shown than shown wrong.
    throw new Error(`Order ${row.id} is in an unknown currency`);
  }
  const leadTime = (leadTimeResult?.results ?? [])[0] as
    | LeadTimeRow
    | undefined;

  return {
    id: row.id,
    orderNo: row.order_no,
    status: row.status as OrderStatus,
    currency: row.currency,
    subtotalMinor: row.subtotal_minor,
    shippingMinor: row.shipping_minor,
    taxMinor: row.tax_minor,
    totalMinor: row.total_minor,
    email: row.email,
    shippingAddress: parseAddress(row.shipping_address),
    locale: row.locale,
    trackingNo: row.tracking_no,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lines: ((lineResult?.results ?? []) as LineRow[]).map((line) => ({
      variantId: line.variant_id,
      sku: line.sku_snapshot,
      name: line.name_snapshot,
      unitPriceMinor: line.unit_price_minor,
      quantity: line.quantity,
    })),
    // The slowest line decides when the order can leave. One line without a
    // stated lead time means no promise can be made for the order at all.
    leadTimeDaysMax:
      leadTime !== undefined &&
      leadTime.lines > 0 &&
      leadTime.stated === leadTime.lines
        ? leadTime.max_days
        : null,
  };
}

/**
 * What a call to `markOrderPaid` did.
 *
 * - `paid`: this call confirmed the payment and took the stock.
 * - `oversold`: this call found the stock gone and marked the order so.
 * - `refused`: the order may not be paid — it was cancelled, or another
 *   payment has settled it. The payment is on record and has to be refunded.
 * - `duplicate`: this payment had been dealt with before, in any of the ways
 *   above. Nothing was written.
 */
export type PaymentOutcome = 'paid' | 'oversold' | 'refused' | 'duplicate';

export interface PaymentResult {
  readonly outcome: PaymentOutcome;
  /** The order's status once this call has returned. */
  readonly status: OrderStatus;
  /**
   * Products whose availability state this call changed, by product group:
   * the ones whose cached pages can be purged at once. Empty unless the
   * outcome is `paid`.
   *
   * A convenience only. What must happen after a payment is in the outbox.
   */
  readonly availabilityChanged: readonly string[];
}

interface PaymentInput {
  readonly orderId: string;
  readonly eventId: string;
  readonly paymentIntentId: string;
  readonly now: Date;
}

interface PaymentState {
  readonly order: { readonly status: OrderStatus } | null;
  /**
   * This payment is on record already: the same event, or another event of
   * the same type about the same payment intent.
   */
  readonly seen: boolean;
  /** Some stock-tracked line asks for more than there is. */
  readonly shortOfStock: boolean;
}

/** Binds the order id. */
const ORDER_SHORT_OF_STOCK = `EXISTS (
  SELECT 1
  FROM p_shop_order_line AS l
  JOIN p_shop_variant AS v ON v.id = l.variant_id
  WHERE l.order_id = ? AND v.stock_policy = 'track' AND v.stock < l.quantity
)`;

/** The payment, the order and whether its stock is there, in one round trip. */
async function readPaymentState(
  db: D1Database,
  input: PaymentInput,
): Promise<PaymentState> {
  const [seenResult, orderResult, shortResult] = await db.batch<
    Record<string, unknown>
  >([
    // Stripe delivers an event more than once, and can send two events about
    // one object, to be told apart by the object's id and the event's type.
    db
      .prepare(
        `SELECT 1 AS seen FROM p_shop_stripe_event
         WHERE event_id = ? OR (type = ? AND payment_intent_id = ?)
         LIMIT 1`,
      )
      .bind(input.eventId, PAYMENT_EVENT_TYPE, input.paymentIntentId),
    db
      .prepare('SELECT status FROM p_shop_order WHERE id = ?')
      .bind(input.orderId),
    db.prepare(`SELECT ${ORDER_SHORT_OF_STOCK} AS short`).bind(input.orderId),
  ]);

  const order = (orderResult?.results ?? [])[0] as
    | { status: string }
    | undefined;
  return {
    order: order === undefined ? null : { status: order.status as OrderStatus },
    seen: (seenResult?.results ?? []).length > 0,
    shortOfStock: (shortResult?.results ?? [])[0]?.short === 1,
  };
}

function variantsOfOrder(db: D1Database, orderId: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT v.id, v.product_group, v.stock, v.moq, v.stock_policy
       FROM p_shop_variant AS v
       WHERE v.id IN (
         SELECT variant_id FROM p_shop_order_line WHERE order_id = ?
       )
       ORDER BY v.id`,
    )
    .bind(orderId);
}

/** The record that a payment was acted on, and how. */
function recordEvent(
  db: D1Database,
  input: PaymentInput,
  outcome: Exclude<PaymentOutcome, 'duplicate'>,
  condition: SqlCondition,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO p_shop_stripe_event
         (event_id, type, order_id, payment_intent_id, outcome, processed_at)
       SELECT ?, ?, ?, ?, ?, ? WHERE ${condition.sql}
       RETURNING event_id`,
    )
    .bind(
      input.eventId,
      PAYMENT_EVENT_TYPE,
      input.orderId,
      input.paymentIntentId,
      outcome,
      input.now.toISOString(),
      ...condition.binds,
    );
}

/**
 * The payment itself: five writes between two readings of the stock.
 *
 * Returns null when the order had already left `from` by the time the batch
 * ran — a delivery racing this one got there first — in which case nothing
 * was written. Throws when a statement failed, which is how a line that
 * would oversell shows itself.
 */
async function writePaid(
  db: D1Database,
  input: PaymentInput,
  from: OrderStatus,
): Promise<PaymentResult | null> {
  const { orderId } = input;
  const nowIso = input.now.toISOString();
  const stillInStatus: SqlCondition = {
    sql: ORDER_STILL_IN_STATUS,
    binds: [orderId, from],
  };

  const results = await db.batch<Record<string, unknown>>([
    variantsOfOrder(db, orderId),
    // Before any stock moves: should this payment somehow be on record
    // already, the record's own keys stop the batch here.
    recordEvent(db, input, 'paid', stillInStatus),
    // Stock-tracked lines only. A made-to-order variant has no stock to take:
    // decrementing its zero would trip the CHECK and turn every such order
    // into "oversold".
    db
      .prepare(
        `UPDATE p_shop_variant
         SET stock = stock - (
               SELECT l.quantity FROM p_shop_order_line AS l
               WHERE l.order_id = ? AND l.variant_id = p_shop_variant.id
             ),
             updated_at = ?
         WHERE stock_policy = 'track'
           AND id IN (
             SELECT variant_id FROM p_shop_order_line WHERE order_id = ?
           )
           AND ${ORDER_STILL_IN_STATUS}`,
      )
      .bind(orderId, nowIso, orderId, orderId, from),
    // The ledger row's id is built from the order and the variant, so the
    // same movement written twice fails, and takes its batch with it.
    db
      .prepare(
        `INSERT INTO p_shop_stock_adjustment
           (id, variant_id, delta, reason, ref_id, created_at)
         SELECT 'order_paid:' || l.order_id || ':' || l.variant_id,
                l.variant_id, -l.quantity, 'order_paid', l.order_id, ?
         FROM p_shop_order_line AS l
         JOIN p_shop_variant AS v ON v.id = l.variant_id
         WHERE l.order_id = ? AND v.stock_policy = 'track'
           AND ${ORDER_STILL_IN_STATUS}`,
      )
      .bind(nowIso, orderId, orderId, from),
    // What is owed because of this payment, committed with it.
    orderChangedOutbox(db, { orderId, from, to: 'paid', now: input.now }),
    // Last: every statement above tests the status this one changes.
    db
      .prepare(
        `UPDATE p_shop_order
         SET status = 'paid', stripe_payment_intent_id = ?, updated_at = ?
         WHERE id = ? AND status = ?
         RETURNING id`,
      )
      .bind(input.paymentIntentId, nowIso, orderId, from),
    variantsOfOrder(db, orderId),
  ]);

  if ((results[5]?.results ?? []).length === 0) {
    return null;
  }
  return {
    outcome: 'paid',
    status: 'paid',
    availabilityChanged: changedProductGroups(
      (results[0]?.results ?? []) as unknown as StockRow[],
      (results[6]?.results ?? []) as unknown as StockRow[],
    ),
  };
}

/**
 * Records a payment that cannot be fulfilled. The payment intent is kept on
 * the order: it is what a person now has to refund.
 *
 * Conditional on the stock still being short as well as on the status. Stock
 * that came back between the reading and this write — another order's refund
 * — means the order can be paid after all, and must not be sent to a person
 * for a refund it does not need.
 *
 * Returns false when either condition no longer held, with nothing written.
 */
async function writeOversold(
  db: D1Database,
  input: PaymentInput,
  from: OrderStatus,
): Promise<boolean> {
  assertTransition(from, 'oversold');
  const { orderId } = input;
  const stillShort: SqlCondition = {
    sql: ORDER_SHORT_OF_STOCK,
    binds: [orderId],
  };

  const results = await db.batch<Record<string, unknown>>([
    recordEvent(db, input, 'oversold', {
      sql: `${ORDER_STILL_IN_STATUS} AND ${ORDER_SHORT_OF_STOCK}`,
      binds: [orderId, from, orderId],
    }),
    orderChangedOutbox(db, {
      orderId,
      from,
      to: 'oversold',
      now: input.now,
      andIf: stillShort,
    }),
    db
      .prepare(
        `UPDATE p_shop_order
         SET status = 'oversold', stripe_payment_intent_id = ?, updated_at = ?
         WHERE id = ? AND status = ? AND ${ORDER_SHORT_OF_STOCK}
         RETURNING id`,
      )
      .bind(
        input.paymentIntentId,
        input.now.toISOString(),
        orderId,
        from,
        orderId,
      ),
  ]);
  return (results[2]?.results ?? []).length > 0;
}

/**
 * Records a payment for an order that may not be paid, and nothing else: the
 * order and the stock are left exactly as they are.
 *
 * The money has been taken all the same. So it goes on record, with an
 * outbox row for a person to refund it, rather than being turned away
 * without a trace.
 *
 * Returns false when the order had already left `from`.
 */
async function writeRefused(
  db: D1Database,
  input: PaymentInput,
  from: OrderStatus,
): Promise<boolean> {
  const results = await db.batch<Record<string, unknown>>([
    recordEvent(db, input, 'refused', {
      sql: ORDER_STILL_IN_STATUS,
      binds: [input.orderId, from],
    }),
    paymentRefusedOutbox(db, {
      orderId: input.orderId,
      from,
      eventId: input.eventId,
      paymentIntentId: input.paymentIntentId,
      now: input.now,
    }),
  ]);
  return (results[0]?.results ?? []).length > 0;
}

type PaymentAction = 'pay' | 'oversold' | 'refuse';

/**
 * Handles a confirmed payment for an order.
 *
 * Safe to call any number of times, at any moment, for the same payment: the
 * stock is taken once. An order whose stock has gone is marked `oversold`
 * with nothing decremented. An order that may not be paid at all is left
 * alone, and the payment recorded for a refund.
 *
 * It works in passes. A pass reads what is true — is the payment on record,
 * what status is the order in, is its stock there — and makes one attempt to
 * act on it. A write that fails, or finds the order moved, is not explained
 * from its error: the next pass reads again and acts on what it finds. That
 * is how a line that would oversell becomes `oversold`, and how losing a race
 * becomes `duplicate`, without either depending on the wording of an error.
 *
 * A write that throws is tried once more if the next reading still calls for
 * it. Stock can go and come back between a reading and a write — one order
 * takes it, another's refund returns it — and the first failure then says
 * nothing about the second attempt. The same write throwing twice running is
 * a real failure.
 *
 * Throws `OrderNotFoundError` for an order that does not exist, and rethrows
 * a database failure. A caller answering a webhook turns the second into a
 * non-2xx response, so that Stripe delivers the event again.
 */
export async function markOrderPaid(
  db: D1Database,
  input: PaymentInput,
): Promise<PaymentResult> {
  let failed:
    | { action: PaymentAction; error: unknown; times: number }
    | undefined;

  // Paying can fail into oversold, and oversold can find the stock back and
  // return to paying. A third change of mind is not worth waiting for.
  for (let pass = 0; pass < 4; pass += 1) {
    const state = await readPaymentState(db, input);
    if (state.order === null) {
      throw new OrderNotFoundError(input.orderId);
    }
    const from = state.order.status;
    if (state.seen) {
      return { outcome: 'duplicate', status: from, availabilityChanged: [] };
    }

    const action: PaymentAction = !canTransition(from, 'paid')
      ? 'refuse'
      : state.shortOfStock
        ? 'oversold'
        : 'pay';
    // Thrown twice running by the same write: a real failure, to be retried
    // by whoever delivered the event.
    if (failed?.action === action && failed.times >= 2) {
      throw failed.error;
    }

    try {
      if (action === 'pay') {
        const paid = await writePaid(db, input, from);
        if (paid !== null) {
          return paid;
        }
      } else if (action === 'oversold') {
        if (await writeOversold(db, input, from)) {
          return {
            outcome: 'oversold',
            status: 'oversold',
            availabilityChanged: [],
          };
        }
      } else if (await writeRefused(db, input, from)) {
        return { outcome: 'refused', status: from, availabilityChanged: [] };
      }
      failed = undefined;
    } catch (error) {
      failed = {
        action,
        error,
        times: failed?.action === action ? failed.times + 1 : 1,
      };
    }
  }

  throw (
    failed?.error ?? new Error(`Order ${input.orderId} could not be settled`)
  );
}
