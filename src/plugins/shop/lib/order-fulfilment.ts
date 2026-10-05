/**
 * What a person does to an order after it is placed: ship it, mark it
 * delivered, cancel it, refund it.
 *
 * Every change is checked against the state machine in `order-state.ts`, and
 * then written only if the order is still in the status that was checked. Two
 * people pressing the same button, or one pressing it twice, change the order
 * once; the other attempt is refused and writes nothing.
 *
 * Every change also puts a row in the outbox, in the same batch: what the
 * buyer is to be told about it is owed from that moment, whatever happens to
 * the request that made the change.
 */

import { changedProductGroups, type StockRow } from './availability.js';
import { ORDER_STILL_IN_STATUS } from './order-guard.js';
import { assertTransition, type OrderStatus } from './order-state.js';
import { OrderNotFoundError } from './orders.js';
import { orderChangedOutbox } from './outbox.js';

interface OrderChange {
  readonly orderId: string;
  readonly now: Date;
}

async function statusOf(db: D1Database, orderId: string): Promise<OrderStatus> {
  const row = await db
    .prepare('SELECT status FROM p_shop_order WHERE id = ?')
    .bind(orderId)
    .first<{ status: string }>();
  if (row === null) {
    throw new OrderNotFoundError(orderId);
  }
  return row.status as OrderStatus;
}

function changedUnderneath(orderId: string): Error {
  return new Error(
    `Order ${orderId} changed while it was being updated; nothing was written`,
  );
}

/** Moves an order to `to`, if the state machine allows it from where it is. */
async function move(
  db: D1Database,
  input: OrderChange,
  to: Exclude<OrderStatus, 'pending'>,
  trackingNo: string | null = null,
): Promise<void> {
  const { orderId, now } = input;
  const from = await statusOf(db, orderId);
  assertTransition(from, to);

  const results = await db.batch<Record<string, unknown>>([
    orderChangedOutbox(db, { orderId, from, to, now }),
    // Last: the outbox row tests the status this statement changes.
    db
      .prepare(
        `UPDATE p_shop_order
         SET status = ?, tracking_no = COALESCE(?, tracking_no), updated_at = ?
         WHERE id = ? AND status = ?
         RETURNING id`,
      )
      .bind(to, trackingNo, now.toISOString(), orderId, from),
  ]);
  if ((results[1]?.results ?? []).length === 0) {
    throw changedUnderneath(orderId);
  }
}

/** Ships a paid order: records the tracking number and moves it on. */
export async function shipOrder(
  db: D1Database,
  input: OrderChange & { readonly trackingNo: string },
): Promise<void> {
  const trackingNo = input.trackingNo.trim();
  if (trackingNo === '') {
    // "Shipped" with nothing to track helps neither support nor the buyer.
    throw new Error('A tracking number is required to ship an order');
  }
  await move(db, input, 'shipped', trackingNo);
}

export async function markDelivered(
  db: D1Database,
  input: OrderChange,
): Promise<void> {
  await move(db, input, 'delivered');
}

/**
 * Cancels an order that has not been paid for, or one that was oversold.
 *
 * A paid order is not cancelled, it is refunded: its stock and its money
 * both have to go back.
 */
export async function cancelOrder(
  db: D1Database,
  input: OrderChange,
): Promise<void> {
  await move(db, input, 'cancelled');
}

function restockedVariants(
  db: D1Database,
  orderId: string,
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT v.id, v.product_group, v.stock, v.moq, v.stock_policy
       FROM p_shop_variant AS v
       WHERE v.id IN (
         SELECT variant_id FROM p_shop_stock_adjustment
         WHERE ref_id = ? AND reason = 'order_paid'
       )
       ORDER BY v.id`,
    )
    .bind(orderId);
}

/**
 * Records a refund: the order moves to `refunded` and the stock it took goes
 * back, in one batch.
 *
 * The stock returned is what the ledger says the payment took, not what the
 * order asked for. An oversold order took nothing, so it gets nothing back;
 * putting its quantity "back" would conjure stock out of nothing.
 *
 * This is the bookkeeping only. Returning the money is `createRefund` in
 * `stripe-client.ts`, and a caller does that first: an order must never read
 * "refunded" while the buyer is still waiting for the money.
 *
 * Returns the products whose availability the returned stock changed, by
 * product group, so their cached pages can be purged.
 */
export async function refundOrder(
  db: D1Database,
  input: OrderChange,
): Promise<{ availabilityChanged: readonly string[] }> {
  const { orderId } = input;
  const nowIso = input.now.toISOString();
  const from = await statusOf(db, orderId);
  assertTransition(from, 'refunded');

  const results = await db.batch<Record<string, unknown>>([
    restockedVariants(db, orderId),
    // `delta` is negative for stock that was taken, so subtracting it adds
    // the same amount back.
    db
      .prepare(
        `UPDATE p_shop_variant
         SET stock = stock - (
               SELECT a.delta FROM p_shop_stock_adjustment AS a
               WHERE a.ref_id = ? AND a.reason = 'order_paid'
                 AND a.variant_id = p_shop_variant.id
             ),
             updated_at = ?
         WHERE id IN (
             SELECT variant_id FROM p_shop_stock_adjustment
             WHERE ref_id = ? AND reason = 'order_paid'
           )
           AND ${ORDER_STILL_IN_STATUS}`,
      )
      .bind(orderId, nowIso, orderId, orderId, from),
    // As with a payment, the row's id is built from what it records: a
    // second refund of the same order cannot be written.
    db
      .prepare(
        `INSERT INTO p_shop_stock_adjustment
           (id, variant_id, delta, reason, ref_id, created_at)
         SELECT 'refund:' || a.ref_id || ':' || a.variant_id, a.variant_id,
                -a.delta, 'refund', a.ref_id, ?
         FROM p_shop_stock_adjustment AS a
         WHERE a.ref_id = ? AND a.reason = 'order_paid'
           AND ${ORDER_STILL_IN_STATUS}`,
      )
      .bind(nowIso, orderId, orderId, from),
    orderChangedOutbox(db, { orderId, from, to: 'refunded', now: input.now }),
    // Last: every statement above tests the status this one changes.
    db
      .prepare(
        `UPDATE p_shop_order SET status = 'refunded', updated_at = ?
         WHERE id = ? AND status = ?
         RETURNING id`,
      )
      .bind(nowIso, orderId, from),
    restockedVariants(db, orderId),
  ]);

  if ((results[4]?.results ?? []).length === 0) {
    throw changedUnderneath(orderId);
  }
  return {
    availabilityChanged: changedProductGroups(
      (results[0]?.results ?? []) as unknown as StockRow[],
      (results[5]?.results ?? []) as unknown as StockRow[],
    ),
  };
}
