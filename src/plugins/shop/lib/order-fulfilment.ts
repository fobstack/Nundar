/**
 * What a person does to an order after it is placed: ship it, mark it
 * delivered, cancel it, refund it, or fulfil one that was oversold once its
 * stock is back.
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
import { ORDER_STILL_IN_STATUS, type SqlCondition } from './order-guard.js';
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

/** The order was not as read by the time the write ran: nothing changed. */
export class OrderChangedError extends Error {
  constructor(orderId: string) {
    super(
      `Order ${orderId} changed while it was being updated; nothing was written`,
    );
    this.name = 'OrderChangedError';
  }
}

function changedUnderneath(orderId: string): Error {
  return new OrderChangedError(orderId);
}

/** Moves an order to `to`, if the state machine allows it from where it is. */
async function move(
  db: D1Database,
  input: OrderChange,
  to: Exclude<OrderStatus, 'pending'>,
  extra: {
    readonly trackingNo?: string | null;
    readonly carrier?: string | null;
    /** Said on the outbox row: why an order was cancelled. */
    readonly ref?: string | null;
    /** Something else about the order that must still hold. */
    readonly andIf?: SqlCondition;
    /** The status already read, when the caller has read it. */
    readonly from?: OrderStatus;
  } = {},
): Promise<void> {
  const { orderId, now } = input;
  const from = extra.from ?? (await statusOf(db, orderId));
  assertTransition(from, to);
  const andIf: SqlCondition = extra.andIf ?? { sql: '1 = 1', binds: [] };

  const results = await db.batch<Record<string, unknown>>([
    orderChangedOutbox(db, {
      orderId,
      from,
      to,
      now,
      ref: extra.ref ?? null,
      ...(extra.andIf === undefined ? {} : { andIf: extra.andIf }),
    }),
    // Last: the outbox row tests the status this statement changes.
    db
      .prepare(
        `UPDATE p_shop_order
         SET status = ?, tracking_no = COALESCE(?, tracking_no),
             carrier = COALESCE(?, carrier), updated_at = ?
         WHERE id = ? AND status = ? AND ${andIf.sql}
         RETURNING id`,
      )
      .bind(
        to,
        extra.trackingNo ?? null,
        extra.carrier ?? null,
        now.toISOString(),
        orderId,
        from,
        ...andIf.binds,
      ),
  ]);
  if ((results[1]?.results ?? []).length === 0) {
    throw changedUnderneath(orderId);
  }
}

/**
 * Ships a paid order: records the tracking number, and the carrier when one
 * is named, and moves it on.
 */
export async function shipOrder(
  db: D1Database,
  input: OrderChange & {
    readonly trackingNo: string;
    readonly carrier?: string | null;
  },
): Promise<void> {
  const trackingNo = input.trackingNo.trim();
  if (trackingNo === '') {
    // "Shipped" with nothing to track helps neither support nor the buyer.
    throw new Error('A tracking number is required to ship an order');
  }
  const carrier = input.carrier?.trim() ?? '';
  await move(db, input, 'shipped', {
    trackingNo,
    carrier: carrier === '' ? null : carrier,
  });
}

export async function markDelivered(
  db: D1Database,
  input: OrderChange,
): Promise<void> {
  await move(db, input, 'delivered');
}

/** Why an order that was never paid for stopped waiting for its payment. */
export type CancelReason =
  /** Its Checkout session expired with nothing paid. */
  | 'expired'
  /** Stripe would not open a Checkout session for it. */
  | 'failed'
  /** The buyer checked the same cart out again, and this one gave way. */
  | 'replaced'
  /** The seller cancelled it. */
  | 'seller';

/**
 * Cancels an order that has not been paid for.
 *
 * A paid order is not cancelled, it is refunded: its stock and its money
 * both have to go back. An oversold one is refunded too, or restocked and
 * fulfilled; cancelling it would leave its payment owed to nobody.
 *
 * The reason is on the outbox row, which is how what follows knows whether
 * the buyer is to be told: they are when the seller cancelled, and not when
 * they simply let the payment page lapse.
 */
export async function cancelOrder(
  db: D1Database,
  input: OrderChange & { readonly reason?: CancelReason },
): Promise<void> {
  await move(db, input, 'cancelled', { ref: input.reason ?? 'seller' });
}

/**
 * Cancels the order a Checkout session was for, once Stripe says the session
 * has expired: nothing can be paid through it any more.
 *
 * Only while the order is still waiting for that session. An order paid
 * meanwhile is not touched, and nor is one recorded against another session.
 * One with no session on record is cancelled too: a session naming it was
 * opened, and only the write that would have recorded it failed.
 *
 * Returns what it found rather than throwing, because each answer is a
 * normal one for a webhook to receive: Stripe also reports a session that
 * expired after its order was cancelled by hand.
 */
export async function expireOrder(
  db: D1Database,
  input: OrderChange & { readonly sessionId: string },
): Promise<'cancelled' | 'not_pending' | 'other_session'> {
  const { orderId } = input;
  const row = await db
    .prepare('SELECT status, stripe_session_id FROM p_shop_order WHERE id = ?')
    .bind(orderId)
    .first<{ status: string; stripe_session_id: string | null }>();
  if (row === null) {
    throw new OrderNotFoundError(orderId);
  }
  if (row.status !== 'pending') {
    return 'not_pending';
  }
  if (
    row.stripe_session_id !== null &&
    row.stripe_session_id !== input.sessionId
  ) {
    return 'other_session';
  }
  try {
    await move(db, input, 'cancelled', {
      ref: 'expired',
      from: 'pending',
      andIf: {
        sql: `(SELECT stripe_session_id IS NULL OR stripe_session_id = ?
               FROM p_shop_order WHERE id = ?)`,
        binds: [input.sessionId, orderId],
      },
    });
    return 'cancelled';
  } catch (error) {
    if (!(error instanceof OrderChangedError)) {
      throw error;
    }
    // Paid, or given a session, between the reading and the write.
    const now = await db
      .prepare('SELECT status FROM p_shop_order WHERE id = ?')
      .bind(orderId)
      .first<{ status: string }>();
    if (now !== null && now.status !== 'pending') {
      return 'not_pending';
    }
    if (now !== null) {
      return 'other_session';
    }
    throw error;
  }
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
 * Records a refund: the order moves to `refunded` and, unless the caller
 * says the goods are not coming back, the stock it took goes back — in one
 * batch.
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
  input: OrderChange & {
    /**
     * Whether what the payment took goes back to stock: yes when the goods
     * never left or have come back, no when they stay with the buyer. Yes
     * unless the caller says otherwise.
     */
    readonly restock?: boolean;
  },
): Promise<{ availabilityChanged: readonly string[] }> {
  const { orderId } = input;
  const nowIso = input.now.toISOString();
  const from = await statusOf(db, orderId);
  assertTransition(from, 'refunded');
  // Bound into the two stock statements: with 0 they match no row, and the
  // refund is recorded with the stock left as it is.
  const restock = input.restock === false ? 0 : 1;

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
           AND ? = 1
           AND ${ORDER_STILL_IN_STATUS}`,
      )
      .bind(orderId, nowIso, orderId, restock, orderId, from),
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
           AND ? = 1
           AND ${ORDER_STILL_IN_STATUS}`,
      )
      .bind(nowIso, orderId, restock, orderId, from),
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

function orderedVariants(db: D1Database, orderId: string): D1PreparedStatement {
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

/**
 * Fulfils an order that was paid for after its stock had gone, once a
 * person has restocked it: the stock is taken now, as the payment would have
 * taken it, and the order becomes `paid`, to ship like any other.
 *
 * One batch, conditional on the order still being oversold. A line whose
 * stock is still short trips the stock's `CHECK` and takes the whole batch
 * with it: nothing is taken, the order stays oversold, and this throws.
 *
 * Returns the products whose availability the stock it took changed.
 */
export async function fulfilOversold(
  db: D1Database,
  input: OrderChange,
): Promise<{ availabilityChanged: readonly string[] }> {
  const { orderId } = input;
  const nowIso = input.now.toISOString();
  const from = await statusOf(db, orderId);
  if (from !== 'oversold') {
    // `paid` is reached from `pending` too, by a payment. This is not one.
    throw new Error(`Illegal order transition: ${from} → paid`);
  }
  assertTransition(from, 'paid');

  const results = await db.batch<Record<string, unknown>>([
    orderedVariants(db, orderId),
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
    // The same ledger row a payment writes: an oversold order never wrote
    // one, and a refund afterwards gives back what it records.
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
    orderChangedOutbox(db, { orderId, from, to: 'paid', now: input.now }),
    // Last: every statement above tests the status this one changes.
    db
      .prepare(
        `UPDATE p_shop_order SET status = 'paid', updated_at = ?
         WHERE id = ? AND status = ?
         RETURNING id`,
      )
      .bind(nowIso, orderId, from),
    orderedVariants(db, orderId),
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
