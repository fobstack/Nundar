/**
 * The outbox: what still has to happen because an order changed.
 *
 * A payment is followed by an email to the buyer and a purge of the product's
 * cached pages. Doing those after the payment's batch has committed leaves a
 * gap: if the Worker stops in between — or the answer to the batch is lost on
 * the way back — the email is never sent and nothing records that it was
 * owed. A later delivery of the same event finds the order paid and has no
 * way to tell that the follow-up is still missing.
 *
 * So the duty is written with the change. Every batch that moves an order
 * also inserts a row here, under the same condition as the rest of the batch,
 * and whoever carries the follow-up out marks the row handled afterwards. A
 * row may be handled twice if the marking is what fails; it cannot be lost.
 *
 * This module writes the rows and reads them back. Nothing consumes them yet:
 * that arrives with the routes.
 */

import { ORDER_STILL_IN_STATUS, type SqlCondition } from './order-guard.js';
import type { OrderStatus } from './order-state.js';

export type OutboxTopic =
  | `order.${Exclude<OrderStatus, 'pending'>}`
  | 'payment.refused';

function insertOutbox(
  db: D1Database,
  row: {
    readonly id: string;
    readonly topic: OutboxTopic;
    readonly orderId: string;
    readonly ref: string | null;
    readonly now: Date;
  },
  condition: SqlCondition,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO p_shop_outbox (id, topic, order_id, ref, created_at)
       SELECT ?, ?, ?, ?, ? WHERE ${condition.sql}`,
    )
    .bind(
      row.id,
      row.topic,
      row.orderId,
      row.ref,
      row.now.toISOString(),
      ...condition.binds,
    );
}

/**
 * The outbox row for an order moving from one status to another, to go in
 * the same batch as the statement that moves it — and before it, since the
 * row is conditional on the status that statement changes.
 *
 * The row's id is the topic and the order. An order enters a status at most
 * once, so the same change cannot be recorded twice.
 */
export function orderChangedOutbox(
  db: D1Database,
  input: {
    readonly orderId: string;
    readonly from: OrderStatus;
    readonly to: Exclude<OrderStatus, 'pending'>;
    readonly now: Date;
    /** Something else that must also hold for the change to be made. */
    readonly andIf?: SqlCondition;
  },
): D1PreparedStatement {
  const topic: OutboxTopic = `order.${input.to}`;
  return insertOutbox(
    db,
    {
      id: `${topic}:${input.orderId}`,
      topic,
      orderId: input.orderId,
      ref: null,
      now: input.now,
    },
    {
      sql:
        input.andIf === undefined
          ? ORDER_STILL_IN_STATUS
          : `${ORDER_STILL_IN_STATUS} AND ${input.andIf.sql}`,
      binds: [input.orderId, input.from, ...(input.andIf?.binds ?? [])],
    },
  );
}

/**
 * The outbox row for a payment an order could not take: money has been
 * received and has to be refunded by a person. Keyed by the event, since an
 * order can be sent more than one such payment.
 */
export function paymentRefusedOutbox(
  db: D1Database,
  input: {
    readonly orderId: string;
    /** The status the order was in, and must still be in, to refuse. */
    readonly from: OrderStatus;
    readonly eventId: string;
    readonly paymentIntentId: string;
    readonly now: Date;
  },
): D1PreparedStatement {
  return insertOutbox(
    db,
    {
      id: `payment.refused:${input.eventId}`,
      topic: 'payment.refused',
      orderId: input.orderId,
      ref: input.paymentIntentId,
      now: input.now,
    },
    { sql: ORDER_STILL_IN_STATUS, binds: [input.orderId, input.from] },
  );
}

export interface OutboxRow {
  readonly id: string;
  readonly topic: OutboxTopic;
  readonly orderId: string;
  readonly ref: string | null;
  readonly createdAt: string;
}

/**
 * The rows still owed, oldest first — all of them, or one order's.
 *
 * Bounded, because the place this will be drained from is the site's shared
 * once-a-minute cron.
 */
export async function pendingOutbox(
  db: D1Database,
  input: { readonly limit: number; readonly orderId?: string },
): Promise<OutboxRow[]> {
  const statement =
    input.orderId === undefined
      ? db
          .prepare(
            `SELECT id, topic, order_id, ref, created_at FROM p_shop_outbox
             WHERE handled_at IS NULL
             ORDER BY created_at, id LIMIT ?`,
          )
          .bind(input.limit)
      : db
          .prepare(
            `SELECT id, topic, order_id, ref, created_at FROM p_shop_outbox
             WHERE handled_at IS NULL AND order_id = ?
             ORDER BY created_at, id LIMIT ?`,
          )
          .bind(input.orderId, input.limit);

  const { results } = await statement.all<{
    id: string;
    topic: string;
    order_id: string;
    ref: string | null;
    created_at: string;
  }>();
  return results.map((row) => ({
    id: row.id,
    topic: row.topic as OutboxTopic,
    orderId: row.order_id,
    ref: row.ref,
    createdAt: row.created_at,
  }));
}

/**
 * Marks rows handled, once what follows from them has been handed over.
 *
 * A row already handled keeps the time it was first handled.
 */
export async function markOutboxHandled(
  db: D1Database,
  ids: readonly string[],
  now: Date,
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await db
    .prepare(
      `UPDATE p_shop_outbox SET handled_at = ?
       WHERE handled_at IS NULL
         AND id IN (SELECT value FROM json_each(?))`,
    )
    .bind(now.toISOString(), JSON.stringify(ids))
    .run();
}
