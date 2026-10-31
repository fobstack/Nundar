/**
 * What the admin does with orders, and with payments the shop could not
 * keep. Mallok lists both from the manifest's panels; these are the panels'
 * actions, each given the ids of the rows that were ticked.
 *
 * Money moves at Stripe before the books move here, never after: a refund is
 * asked of Stripe and then recorded, so an order never reads "refunded"
 * while the buyer waits for the money; a session is expired at Stripe and
 * then its order cancelled, so a cancelled order cannot still be paid. Both
 * Stripe calls are keyed, so pressing the button again after a failure
 * halfway repeats nothing at Stripe and finishes the bookkeeping.
 *
 * A refusal answers 422 with a message the admin shows. What a change owes
 * the buyer — an email — is queued as the order's follow-up job.
 */

import type { PluginContext } from 'mallok/worker';
import { FOLLOW_UP_JOB } from './order-follow-up.js';
import {
  cancelOrder,
  fulfilOversold,
  markDelivered,
  refundOrder,
  shipOrder,
} from './order-fulfilment.js';
import type { OrderStatus } from './order-state.js';
import {
  createRefund,
  expireCheckoutSession,
  StripeRequestError,
} from './stripe-client.js';

/**
 * A refund asked of Stripe, or the word that the payment had been refunded
 * already — in Stripe's dashboard, say — which is as good for the books.
 */
async function refundAtStripe(
  secretKey: string,
  paymentIntentId: string,
  reason?: 'requested_by_customer',
): Promise<{ id: string }> {
  try {
    return await createRefund(secretKey, {
      paymentIntentId,
      ...(reason === undefined ? {} : { reason }),
    });
  } catch (error) {
    if (
      error instanceof StripeRequestError &&
      error.code === 'charge_already_refunded'
    ) {
      return { id: REFUNDED_OUTSIDE };
    }
    throw error;
  }
}

/** What a refund made outside the shop is recorded as: Stripe gave no id. */
export const REFUNDED_OUTSIDE = 'refunded_outside_shop';

/** The most orders one action changes. */
const ACTION_LIMIT = 20;

/** The carriers offered by name (design §20, D18); `Other` asks for one. */
export const CARRIERS = ['DHL', 'FedEx', 'UPS', 'Other'] as const;

function refused(error: string, errors?: Record<string, string>): Response {
  return Response.json(
    { error, ...(errors === undefined ? {} : { errors }) },
    { status: 422 },
  );
}

interface OrderRow {
  id: string;
  order_no: string;
  status: OrderStatus;
  stripe_payment_intent_id: string | null;
  stripe_session_id: string | null;
}

async function readOrders(
  db: D1Database,
  ids: readonly string[],
): Promise<OrderRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, order_no, status, stripe_payment_intent_id, stripe_session_id
       FROM p_shop_order WHERE id IN (SELECT value FROM json_each(?))
       ORDER BY created_at`,
    )
    .bind(JSON.stringify(ids.slice(0, ACTION_LIMIT)))
    .all<OrderRow>();
  return results;
}

/** Queues what a change owes; the cron takes it up if this cannot. */
async function owe(ctx: PluginContext, orderId: string): Promise<void> {
  try {
    await ctx.enqueue(FOLLOW_UP_JOB, { orderId });
  } catch {
    console.log(
      JSON.stringify({ event: 'shop_follow_up_not_queued', orderId }),
    );
  }
}

/** What went wrong with each order that was not changed, for the admin. */
function summary(
  problems: readonly string[],
  done: number,
): Response | undefined {
  if (problems.length === 0) {
    return undefined;
  }
  return refused(
    `${done === 0 ? 'Nothing was changed' : `${done} changed`}. ${problems.join(' ')}`,
  );
}

function why(order: OrderRow, needed: string): string {
  return `${order.order_no} is ${order.status}: ${needed}.`;
}

/** Ships one order: a tracking number and a carrier are required (D18). */
export async function shipOrders(
  ids: readonly string[],
  ctx: PluginContext,
  params: Readonly<Record<string, unknown>>,
  now: Date = new Date(),
): Promise<Response | undefined> {
  if (ids.length !== 1) {
    return refused(
      'Ship one order at a time: each has its own tracking number.',
    );
  }
  const trackingNo =
    typeof params.tracking_no === 'string' ? params.tracking_no.trim() : '';
  const chosen = typeof params.carrier === 'string' ? params.carrier : '';
  const other =
    typeof params.carrier_other === 'string' ? params.carrier_other.trim() : '';
  if (trackingNo === '' || trackingNo.length > 100) {
    return refused('A tracking number is required.', {
      tracking_no: 'Enter the tracking number, at most 100 characters.',
    });
  }
  if (!(CARRIERS as readonly string[]).includes(chosen)) {
    return refused('Choose a carrier.', { carrier: 'Choose a carrier.' });
  }
  if (chosen === 'Other' && (other === '' || other.length > 100)) {
    return refused('Name the carrier.', {
      carrier_other: 'Name the carrier, at most 100 characters.',
    });
  }
  const [order] = await readOrders(ctx.db, ids);
  if (order === undefined) {
    return refused('That order no longer exists.');
  }
  if (order.status !== 'paid') {
    return refused(why(order, 'only a paid order can be shipped'));
  }
  try {
    await shipOrder(ctx.db, {
      orderId: order.id,
      trackingNo,
      carrier: chosen === 'Other' ? other : chosen,
      now,
    });
  } catch {
    return refused(`${order.order_no} changed meanwhile. Nothing was changed.`);
  }
  await owe(ctx, order.id);
  return undefined;
}

export async function deliverOrders(
  ids: readonly string[],
  ctx: PluginContext,
  now: Date = new Date(),
): Promise<Response | undefined> {
  const problems: string[] = [];
  let done = 0;
  for (const order of await readOrders(ctx.db, ids)) {
    if (order.status !== 'shipped') {
      problems.push(why(order, 'only a shipped order can be marked delivered'));
      continue;
    }
    try {
      await markDelivered(ctx.db, { orderId: order.id, now });
      done += 1;
    } catch {
      problems.push(`${order.order_no} changed meanwhile.`);
    }
  }
  return summary(problems, done);
}

/**
 * Cancels orders still waiting for their payment. Each one's Checkout
 * session is expired at Stripe first, so it cannot be paid once cancelled;
 * one that Stripe says is no longer open is looked at again — it may have
 * just been paid — before anything is written.
 */
export async function cancelOrders(
  ids: readonly string[],
  ctx: PluginContext,
  params: Readonly<Record<string, unknown>>,
  now: Date = new Date(),
): Promise<Response | undefined> {
  if (params.confirm !== true) {
    return refused('Tick the box to confirm.', {
      confirm: 'Tick the box to cancel these orders.',
    });
  }
  const secretKey = ctx.secrets.stripe_secret_key ?? '';
  const problems: string[] = [];
  let done = 0;
  for (const order of await readOrders(ctx.db, ids)) {
    if (order.status !== 'pending') {
      problems.push(
        why(
          order,
          order.status === 'oversold'
            ? 'refund it, or restock and fulfil it'
            : 'only an order waiting for payment can be cancelled; refund a paid one',
        ),
      );
      continue;
    }
    if (order.stripe_session_id !== null) {
      if (secretKey === '') {
        problems.push(
          `${order.order_no}: set the Stripe secret key first, so that its payment page can be closed.`,
        );
        continue;
      }
      try {
        const closed = await expireCheckoutSession(
          secretKey,
          order.stripe_session_id,
        );
        if (closed === 'not_open') {
          const [now2] = await readOrders(ctx.db, [order.id]);
          if (now2 === undefined || now2.status !== 'pending') {
            problems.push(`${order.order_no} was paid meanwhile.`);
            continue;
          }
        }
      } catch (error) {
        problems.push(
          `${order.order_no}: Stripe could not be reached (${error instanceof Error ? error.message : 'unknown'}). Try again.`,
        );
        continue;
      }
    }
    try {
      await cancelOrder(ctx.db, { orderId: order.id, reason: 'seller', now });
      done += 1;
      await owe(ctx, order.id);
    } catch {
      problems.push(`${order.order_no} changed meanwhile.`);
    }
  }
  return summary(problems, done);
}

/** Which way the stock goes when an order is refunded (D11). */
export const RESTOCK_CHOICES = [
  'Back to stock unless it has shipped',
  'Back to stock',
  'Leave the stock as it is',
] as const;

function restockFor(choice: unknown, status: OrderStatus): boolean {
  if (choice === RESTOCK_CHOICES[1]) {
    return true;
  }
  if (choice === RESTOCK_CHOICES[2]) {
    return false;
  }
  return status === 'paid' || status === 'oversold';
}

/**
 * Refunds orders in full (D11): the money at Stripe first, then the order
 * and, as chosen, its stock.
 */
export async function refundOrders(
  ids: readonly string[],
  ctx: PluginContext,
  params: Readonly<Record<string, unknown>>,
  now: Date = new Date(),
): Promise<Response | undefined> {
  if (params.confirm !== true) {
    return refused('Tick the box to confirm.', {
      confirm: 'Tick the box to refund these orders in full.',
    });
  }
  const secretKey = ctx.secrets.stripe_secret_key ?? '';
  if (secretKey === '') {
    return refused(
      'Set the Stripe secret key first: the refund is made at Stripe.',
    );
  }
  const problems: string[] = [];
  let done = 0;
  for (const order of await readOrders(ctx.db, ids)) {
    if (
      !['paid', 'shipped', 'delivered', 'oversold'].includes(order.status) ||
      order.stripe_payment_intent_id === null
    ) {
      problems.push(why(order, 'only an order that was paid can be refunded'));
      continue;
    }
    try {
      await refundAtStripe(
        secretKey,
        order.stripe_payment_intent_id,
        'requested_by_customer',
      );
    } catch (error) {
      problems.push(
        `${order.order_no}: Stripe did not refund it (${error instanceof Error ? error.message : 'unknown'}).`,
      );
      continue;
    }
    try {
      await refundOrder(ctx.db, {
        orderId: order.id,
        restock: restockFor(params.restock, order.status),
        now,
      });
      done += 1;
      await owe(ctx, order.id);
    } catch {
      // The money has gone back; the order says so once this is pressed
      // again, which asks Stripe for nothing new.
      problems.push(
        `${order.order_no} was refunded at Stripe but changed here meanwhile: refund it again to record it.`,
      );
    }
  }
  return summary(problems, done);
}

/** Fulfils oversold orders once their stock is back (D12). */
export async function fulfilOrders(
  ids: readonly string[],
  ctx: PluginContext,
  params: Readonly<Record<string, unknown>>,
  now: Date = new Date(),
): Promise<Response | undefined> {
  if (params.confirm !== true) {
    return refused('Tick the box to confirm.', {
      confirm: 'Tick the box once the stock is back.',
    });
  }
  const problems: string[] = [];
  let done = 0;
  for (const order of await readOrders(ctx.db, ids)) {
    if (order.status !== 'oversold') {
      problems.push(why(order, 'only an oversold order is fulfilled this way'));
      continue;
    }
    try {
      await fulfilOversold(ctx.db, { orderId: order.id, now });
      done += 1;
      await owe(ctx, order.id);
    } catch {
      problems.push(
        `${order.order_no}: there is not enough stock yet for every line. Restock it first.`,
      );
    }
  }
  return summary(problems, done);
}

/**
 * Refunds payments the shop took and could not keep, and records each
 * refund on its event. Keyed on the payment, as every refund is.
 */
export async function refundRefusedPayments(
  ids: readonly string[],
  ctx: PluginContext,
  params: Readonly<Record<string, unknown>>,
): Promise<Response | undefined> {
  if (params.confirm !== true) {
    return refused('Tick the box to confirm.', {
      confirm: 'Tick the box to refund these payments in full.',
    });
  }
  const secretKey = ctx.secrets.stripe_secret_key ?? '';
  if (secretKey === '') {
    return refused(
      'Set the Stripe secret key first: the refund is made at Stripe.',
    );
  }
  const { results } = await ctx.db
    .prepare(
      `SELECT event_id, payment_intent_id, refund_id FROM p_shop_stripe_event
       WHERE outcome = 'refused'
         AND event_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(JSON.stringify(ids.slice(0, ACTION_LIMIT)))
    .all<{
      event_id: string;
      payment_intent_id: string;
      refund_id: string | null;
    }>();
  const problems: string[] = [];
  let done = 0;
  for (const row of results) {
    if (row.refund_id !== null) {
      continue;
    }
    try {
      // No reason: the payment was neither a duplicate nor the buyer's
      // request, and Stripe offers nothing else.
      const refund = await refundAtStripe(secretKey, row.payment_intent_id);
      await ctx.db
        .prepare(
          `UPDATE p_shop_stripe_event SET refund_id = ?
           WHERE event_id = ? AND refund_id IS NULL`,
        )
        .bind(refund.id, row.event_id)
        .run();
      done += 1;
    } catch (error) {
      problems.push(
        `${row.payment_intent_id}: not refunded (${error instanceof Error ? error.message : 'unknown'}).`,
      );
    }
  }
  return summary(problems, done);
}
