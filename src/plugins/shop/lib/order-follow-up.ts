/**
 * Carrying out what the outbox says a change of an order still owes.
 *
 * Every change of an order writes its outbox row in its own batch
 * (`outbox.ts`). This is what reads the rows back and does the rest: the
 * buyer's email, the seller's, the purge of the product pages whose stock
 * moved. It runs from a job the change queues (`FOLLOW_UP_JOB`), and the
 * minute's cron takes up whatever a job left behind — a job that failed five
 * times, or one that was never queued because the request stopped after its
 * batch (design §20: Mallok's jobs, with the cron behind them).
 *
 * A row is claimed before its follow-up runs, so that a job and the cron
 * that meet over it do not both send its email; a claim older than ten
 * minutes is taken to belong to a runner that stopped. A row whose follow-up
 * fails is let go and stops the rest of its order's rows: "shipped" must not
 * reach the buyer before "confirmed", and a row another runner holds holds
 * its order's later rows back too. Each email a row owes is marked on the
 * row once handed over — to Mallok's email queue, which retries delivery
 * itself — and the row is marked handled once all of them are: a row run
 * again sends only what it had not, and an email arrives twice only if a
 * marking itself is what fails. None is lost.
 *
 * What each topic owes:
 *
 *   order.paid        buyer: confirmed. Seller: a new order, unless it was
 *                     oversold first and the seller restocked it. Purge.
 *   order.oversold    seller: refund it, or restock and fulfil it.
 *   payment.refused   seller: this payment has to be refunded.
 *   order.shipped     buyer: shipped, with the carrier and tracking number.
 *   order.refunded    buyer: refunded. Purge, for the stock that came back.
 *   order.cancelled   buyer: cancelled — only when the seller cancelled it,
 *                     not when its payment page lapsed or gave way to
 *                     another: the address was never proven to be theirs.
 *   order.delivered   nothing.
 */

import type { EmailMessage } from 'mallok/worker';
import { orderLinkKey, orderToken } from './order-access.js';
import {
  cancellationEmail,
  type EmailContent,
  orderConfirmationEmail,
  type RefusedBecause,
  refundNotificationEmail,
  sellerNewOrderEmail,
  sellerOversoldEmail,
  sellerRefundOwedEmail,
  shippingNotificationEmail,
} from './order-email.js';
import { getOrder, type OrderDetail } from './orders.js';
import { markOutboxHandled, type OutboxTopic } from './outbox.js';
import { orderLink } from './paths.js';
import { productCacheTag, purgeOutcome } from './render-data.js';

/** The job a change of an order queues for what it owes. */
export const FOLLOW_UP_JOB = 'order_follow_up';

/** How long a claim holds before it is taken to belong to a runner that stopped. */
const CLAIM_HOLD_MS = 10 * 60 * 1000;

/** What the runner needs of Mallok's context. */
export interface FollowUpContext {
  readonly db: D1Database;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly site: { readonly defaultLocale: string };
  readonly sendEmail: (message: EmailMessage) => Promise<string>;
  readonly purgeTags?: (tags: readonly string[]) => Promise<unknown>;
}

interface Row {
  id: string;
  topic: OutboxTopic;
  order_id: string;
  ref: string | null;
  /** The steps handed over already, a word each, comma-separated. */
  progress: string;
}

/**
 * Sends one email a row owes, unless a run before this one handed it over
 * already, and marks it handed over. So a row that owes two and fails at the
 * second sends only the second when it is run again.
 */
async function once(
  ctx: FollowUpContext,
  row: Row,
  step: string,
  send: () => Promise<unknown>,
): Promise<void> {
  if (row.progress.split(',').includes(step)) {
    return;
  }
  await send();
  await ctx.db
    .prepare(
      `UPDATE p_shop_outbox
       SET progress = CASE WHEN progress = '' THEN ? ELSE progress || ',' || ? END
       WHERE id = ?`,
    )
    .bind(step, step, row.id)
    .run();
  row.progress = row.progress === '' ? step : `${row.progress},${step}`;
}

/** Where the seller is told; null when the shop has nowhere to tell them. */
function sellerAddress(
  settings: Readonly<Record<string, unknown>>,
): string | null {
  const value = settings.inquiry_recipient;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function message(
  to: string,
  content: EmailContent,
  replyTo?: string,
): EmailMessage {
  return {
    to,
    subject: content.subject,
    text: content.text,
    html: content.html,
    ...(replyTo === undefined ? {} : { replyTo }),
  };
}

async function linkOf(
  ctx: FollowUpContext,
  order: OrderDetail,
  now: Date,
): Promise<string | undefined> {
  if (order.siteOrigin === '') {
    return undefined;
  }
  const token = await orderToken(await orderLinkKey(ctx.db, now), order.id);
  return orderLink({
    origin: order.siteOrigin,
    orderNo: order.orderNo,
    token,
    locale: order.locale,
    defaultLocale: ctx.site.defaultLocale,
  });
}

/**
 * Purges the pages of every product on the order. Which of them changed is
 * known only to the call that made the change; purging all of them is
 * always safe. A purge that does not happen leaves the pages to expire, and
 * is not a failure of the row.
 */
async function purgeOrderProducts(
  ctx: FollowUpContext,
  orderId: string,
): Promise<void> {
  if (ctx.purgeTags === undefined) {
    return;
  }
  const { results } = await ctx.db
    .prepare(
      `SELECT DISTINCT v.product_group AS product_group
       FROM p_shop_order_line AS l
       JOIN p_shop_variant AS v ON v.id = l.variant_id
       WHERE l.order_id = ?`,
    )
    .bind(orderId)
    .all<{ product_group: string }>();
  if (results.length === 0) {
    return;
  }
  try {
    const answer = await ctx.purgeTags(
      results.map((row) => productCacheTag(row.product_group)),
    );
    if (purgeOutcome(answer) === 'refused') {
      console.log(
        JSON.stringify({ event: 'shop_purge_failed', reason: 'refused' }),
      );
    }
  } catch {
    console.log(
      JSON.stringify({ event: 'shop_purge_failed', reason: 'threw' }),
    );
  }
}

/** Why a refused payment could not be kept, read from the order as it is. */
function refusedBecause(
  order: OrderDetail,
  paymentIntentId: string,
): RefusedBecause {
  if (
    order.stripePaymentIntentId !== null &&
    order.stripePaymentIntentId !== paymentIntentId
  ) {
    return 'already_paid';
  }
  if (order.status === 'cancelled') {
    return 'cancelled';
  }
  return 'amount_mismatch';
}

/** Whether the order was oversold before it was paid: the seller restocked it. */
async function wasOversold(
  ctx: FollowUpContext,
  orderId: string,
): Promise<boolean> {
  const row = await ctx.db
    .prepare(
      `SELECT 1 AS hit FROM p_shop_stripe_event
       WHERE order_id = ? AND outcome = 'oversold' LIMIT 1`,
    )
    .bind(orderId)
    .first<{ hit: number }>();
  return row !== null;
}

/** Does what one row owes. Throws when something it owes could not be handed over. */
async function perform(
  ctx: FollowUpContext,
  row: Row,
  now: Date,
): Promise<void> {
  const order = await getOrder(ctx.db, { id: row.order_id });
  if (order === null) {
    // Nothing is left to tell anyone about.
    return;
  }
  const seller = sellerAddress(ctx.settings);

  switch (row.topic) {
    case 'order.paid': {
      const link = await linkOf(ctx, order, now);
      await once(ctx, row, 'buyer', () =>
        ctx.sendEmail(
          message(order.email, orderConfirmationEmail(order, link)),
        ),
      );
      if (seller !== null && !(await wasOversold(ctx, order.id))) {
        await once(ctx, row, 'seller', () =>
          ctx.sendEmail(
            message(seller, sellerNewOrderEmail(order), order.email),
          ),
        );
      }
      await purgeOrderProducts(ctx, order.id);
      return;
    }
    case 'order.oversold':
      if (seller !== null) {
        await once(ctx, row, 'seller', () =>
          ctx.sendEmail(
            message(seller, sellerOversoldEmail(order), order.email),
          ),
        );
      }
      return;
    case 'payment.refused': {
      const paymentIntentId = row.ref;
      if (seller !== null && paymentIntentId !== null) {
        await once(ctx, row, 'seller', () =>
          ctx.sendEmail(
            message(
              seller,
              sellerRefundOwedEmail({
                orderNo: order.orderNo,
                paymentIntentId,
                because: refusedBecause(order, paymentIntentId),
              }),
            ),
          ),
        );
      }
      return;
    }
    case 'order.shipped': {
      const link = await linkOf(ctx, order, now);
      await once(ctx, row, 'buyer', () =>
        ctx.sendEmail(
          message(
            order.email,
            shippingNotificationEmail({
              orderNo: order.orderNo,
              locale: order.locale,
              trackingNo: order.trackingNo,
              carrier: order.carrier,
              ...(link === undefined ? {} : { orderUrl: link }),
            }),
          ),
        ),
      );
      return;
    }
    case 'order.refunded': {
      const link = await linkOf(ctx, order, now);
      await once(ctx, row, 'buyer', () =>
        ctx.sendEmail(
          message(
            order.email,
            refundNotificationEmail({
              orderNo: order.orderNo,
              locale: order.locale,
              currency: order.currency,
              totalMinor: order.totalMinor,
              ...(link === undefined ? {} : { orderUrl: link }),
            }),
          ),
        ),
      );
      await purgeOrderProducts(ctx, order.id);
      return;
    }
    case 'order.cancelled':
      if (row.ref === 'seller') {
        await once(ctx, row, 'buyer', () =>
          ctx.sendEmail(
            message(
              order.email,
              cancellationEmail({
                orderNo: order.orderNo,
                locale: order.locale,
              }),
            ),
          ),
        );
      }
      return;
    case 'order.delivered':
      return;
  }
}

/**
 * Takes up a row for this runner. False when another has it, or it was
 * handled meanwhile.
 */
async function claim(db: D1Database, id: string, now: Date): Promise<boolean> {
  const row = await db
    .prepare(
      `UPDATE p_shop_outbox SET claimed_at = ?
       WHERE id = ? AND handled_at IS NULL
         AND (claimed_at IS NULL OR claimed_at <= ?)
       RETURNING id`,
    )
    .bind(
      now.toISOString(),
      id,
      new Date(now.getTime() - CLAIM_HOLD_MS).toISOString(),
    )
    .first<{ id: string }>();
  return row !== null;
}

export interface FollowUpOutcome {
  readonly handled: number;
  readonly failed: number;
}

/**
 * Carries out the rows still owed — one order's, or any — oldest first.
 *
 * `committedBefore` leaves out rows newer than it: the cron passes it so as
 * not to race the job a change has just queued for its own rows.
 */
export async function runFollowUps(
  ctx: FollowUpContext,
  input: {
    readonly now: Date;
    readonly limit: number;
    readonly orderId?: string;
    readonly committedBefore?: Date;
  },
): Promise<FollowUpOutcome> {
  const { now } = input;
  const { results } = await ctx.db
    .prepare(
      // Rows another runner has in hand are read too: a claim that fails
      // below holds back its order's later rows, which must not overtake it.
      `SELECT id, topic, order_id, ref, progress FROM p_shop_outbox
       WHERE handled_at IS NULL
         AND (? IS NULL OR order_id = ?)
         AND (? IS NULL OR created_at <= ?)
       ORDER BY seq LIMIT ?`,
    )
    .bind(
      input.orderId ?? null,
      input.orderId ?? null,
      input.committedBefore?.toISOString() ?? null,
      input.committedBefore?.toISOString() ?? null,
      input.limit,
    )
    .all<Row>();

  let handled = 0;
  let failed = 0;
  // An order one of whose rows could not be carried out: its later rows wait.
  const held = new Set<string>();
  for (const row of results) {
    if (held.has(row.order_id)) {
      continue;
    }
    if (!(await claim(ctx.db, row.id, now))) {
      held.add(row.order_id);
      continue;
    }
    try {
      await perform(ctx, row, now);
    } catch (error) {
      held.add(row.order_id);
      failed += 1;
      await ctx.db
        .prepare('UPDATE p_shop_outbox SET claimed_at = NULL WHERE id = ?')
        .bind(row.id)
        .run();
      // The topic and the order's id, which name nobody.
      console.log(
        JSON.stringify({
          event: 'shop_follow_up_failed',
          topic: row.topic,
          orderId: row.order_id,
          reason: error instanceof Error ? error.name : 'unknown',
        }),
      );
      continue;
    }
    await markOutboxHandled(ctx.db, [row.id], now);
    handled += 1;
  }
  return { handled, failed };
}

/** The job: one order's rows. Throws when one failed, so Mallok tries again. */
export async function followUpJob(
  payload: unknown,
  ctx: FollowUpContext,
  now: Date = new Date(),
): Promise<void> {
  const orderId =
    payload !== null &&
    typeof payload === 'object' &&
    typeof (payload as { orderId?: unknown }).orderId === 'string'
      ? (payload as { orderId: string }).orderId
      : null;
  if (orderId === null) {
    // Not a payload this plugin queues: nothing to retry it for.
    return;
  }
  const outcome = await runFollowUps(ctx, { now, limit: 20, orderId });
  if (outcome.failed > 0) {
    throw new Error(`${outcome.failed} follow-up(s) of an order failed`);
  }
}
