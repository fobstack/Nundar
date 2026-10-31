/**
 * The shop's share of the site's once-a-minute cron.
 *
 * Mallok runs one cron for the whole site, and every plugin's `scheduled`
 * hook shares that invocation's CPU budget (10 ms on the Workers Free plan).
 * So a tick does **one** small piece of work and returns: what an order's
 * change still owes and its job left behind goes first, then closing orders
 * whose payment page lapsed with no word from Stripe, then a repricing run
 * in progress, then a rate refresh if one is due, then clearing expired
 * carts. Whatever is left waits for the next minute.
 */

import { deleteExpiredCarts } from './cart.js';
import { BASE_CURRENCY, CURRENCIES } from './currency.js';
import { fetchEcbRates, ratesFromBase } from './ecb.js';
import { type FollowUpContext, runFollowUps } from './order-follow-up.js';
import { cancelOrder } from './order-fulfilment.js';
import { pricingRulesFromSettings } from './pricing.js';
import { readRates, repriceChunk, storeRatesStatements } from './rates.js';
import { productCacheTag, purgeOutcome } from './render-data.js';
import {
  clearStateStatement,
  readState,
  STATE_KEYS,
  setStateStatement,
} from './state.js';
import { closeCheckoutSession } from './stripe-client.js';

/**
 * How often the rates are fetched. The ECB publishes once per working day, so
 * four attempts a day find a new figure within hours and cost four
 * subrequests; a failed attempt simply waits for the next one.
 */
const RATES_INTERVAL_MS = 6 * 60 * 60 * 1000;

const CART_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** Variants repriced per tick. */
const REPRICE_CHUNK = 50;

/** Expired carts deleted per cleanup. */
const CART_CLEANUP_LIMIT = 50;

/**
 * How old an outbox row is before the cron takes it up: its own job runs
 * within a minute or two, and the cron is for what that job left behind.
 */
const FOLLOW_UP_GRACE_MS = 5 * 60 * 1000;

/** Outbox rows carried out per tick. Each is a read and an email or two. */
const FOLLOW_UP_LIMIT = 5;

const ORDER_SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/**
 * How long after its payment page lapsed an order is closed by the cron.
 * Stripe's own word — `checkout.session.expired` — closes it sooner; this is
 * for a word that never came, and leaves time for a payment made in the last
 * moment whose word is late.
 */
const LAPSED_GRACE_MS = 60 * 60 * 1000;

/** Orders closed per sweep: each may be a request to Stripe. */
const ORDER_SWEEP_LIMIT = 5;

export type TickOutcome =
  | {
      readonly kind: 'repriced';
      readonly updated: number;
      readonly skipped: number;
      readonly manual: number;
      /**
       * Products whose pages were purged because a price on them moved: 0
       * when there was nothing to purge with, or the purge did not happen.
       */
      readonly purged: number;
      readonly done: boolean;
    }
  | {
      readonly kind: 'rates_refreshed';
      readonly referenceDate: string;
      readonly repricing: boolean;
    }
  | { readonly kind: 'rates_failed'; readonly reason: string }
  | { readonly kind: 'carts_cleaned'; readonly deleted: number }
  | {
      readonly kind: 'follow_ups';
      readonly handled: number;
      readonly failed: number;
    }
  | { readonly kind: 'orders_lapsed'; readonly cancelled: number }
  | { readonly kind: 'idle' };

function elapsed(since: string | undefined, now: Date): number {
  if (since === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  const then = Date.parse(since);
  return Number.isNaN(then) ? Number.POSITIVE_INFINITY : now.getTime() - then;
}

/**
 * Orders still waiting for a payment that has not come: their page lapsed an
 * hour ago, or none was recorded for them and they are two hours old — a
 * page lives one.
 *
 * Stripe is asked first about an order with a page. One Stripe has complete
 * was paid, and its word is late — a webhook that failed and is being
 * delivered again — so it is left to that word. Without the secret key
 * nothing can be asked, and such an order is left as it is.
 */
async function closeLapsedOrders(
  db: D1Database,
  now: Date,
  secretKey: string | null,
  fetchImpl: typeof fetch,
): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT id, stripe_session_id FROM p_shop_order
       WHERE status = 'pending'
         AND ((stripe_session_expires_at IS NOT NULL
               AND stripe_session_expires_at <= ?)
           OR (stripe_session_expires_at IS NULL AND created_at <= ?))
       ORDER BY created_at LIMIT ?`,
    )
    .bind(
      new Date(now.getTime() - LAPSED_GRACE_MS).toISOString(),
      new Date(now.getTime() - 2 * LAPSED_GRACE_MS).toISOString(),
      ORDER_SWEEP_LIMIT,
    )
    .all<{ id: string; stripe_session_id: string | null }>();
  let cancelled = 0;
  for (const row of results) {
    if (row.stripe_session_id !== null) {
      if (secretKey === null) {
        continue;
      }
      try {
        if (
          (await closeCheckoutSession(
            secretKey,
            row.stripe_session_id,
            fetchImpl,
          )) === 'paid'
        ) {
          continue;
        }
      } catch {
        // Stripe could not say: asked again at the next sweep.
        continue;
      }
    }
    try {
      await cancelOrder(db, { orderId: row.id, reason: 'expired', now });
      cancelled += 1;
    } catch {
      // Paid meanwhile: it is no longer waiting.
    }
  }
  return cancelled;
}

export async function runScheduledTick(
  ctx: {
    readonly db: D1Database;
    readonly settings: Readonly<Record<string, unknown>>;
    /** Purges the shop's own cache tags; absent where there is no cache. */
    readonly purgeTags?: (tags: readonly string[]) => Promise<unknown>;
    /** Sends an email; absent where a tick is run for its pricing only. */
    readonly sendEmail?: FollowUpContext['sendEmail'];
    readonly site?: FollowUpContext['site'];
    /** The shop's secrets: the Stripe key the sweep asks Stripe with. */
    readonly secrets?: Readonly<Record<string, string>>;
  },
  deps: {
    readonly fetch?: typeof fetch;
    readonly now?: () => Date;
  } = {},
): Promise<TickOutcome> {
  const { db } = ctx;
  const now = (deps.now ?? (() => new Date()))();

  // 1. What changes of orders still owe, that their own jobs left behind.
  if (ctx.sendEmail !== undefined && ctx.site !== undefined) {
    const outcome = await runFollowUps(
      {
        db,
        settings: ctx.settings,
        site: ctx.site,
        sendEmail: ctx.sendEmail,
        ...(ctx.purgeTags === undefined ? {} : { purgeTags: ctx.purgeTags }),
      },
      {
        now,
        limit: FOLLOW_UP_LIMIT,
        committedBefore: new Date(now.getTime() - FOLLOW_UP_GRACE_MS),
      },
    );
    if (outcome.handled + outcome.failed > 0) {
      return { kind: 'follow_ups', ...outcome };
    }
  }

  const state = await readState(db);

  // 2. Orders whose payment page lapsed with no word from Stripe.
  if (
    elapsed(state.get(STATE_KEYS.ordersSweptAt), now) >= ORDER_SWEEP_INTERVAL_MS
  ) {
    await setStateStatement(
      db,
      STATE_KEYS.ordersSweptAt,
      now.toISOString(),
      now,
    ).run();
    const key = ctx.secrets?.stripe_secret_key ?? '';
    const cancelled = await closeLapsedOrders(
      db,
      now,
      key === '' ? null : key,
      deps.fetch ?? fetch,
    );
    if (cancelled > 0) {
      return { kind: 'orders_lapsed', cancelled };
    }
  }

  // 3. A repricing run in progress: do the next chunk and nothing else.
  const cursor = state.get(STATE_KEYS.repriceCursor);
  if (cursor !== undefined) {
    const result = await repriceChunk(db, {
      rules: pricingRulesFromSettings(ctx.settings),
      cursor,
      limit: REPRICE_CHUNK,
      now,
    });
    await (result.nextCursor === null
      ? clearStateStatement(db, STATE_KEYS.repriceCursor)
      : setStateStatement(db, STATE_KEYS.repriceCursor, result.nextCursor, now)
    ).run();
    // The pages of the products whose prices just moved say the old price.
    // One purge for the chunk — a chunk is fifty variants, and a purge call
    // carries a hundred tags. The prices are written and the run has moved
    // on either way: a purge that fails leaves those pages to expire, and
    // repeating the chunk would find nothing left to change.
    let purged = 0;
    if (result.changedProductGroups.length > 0 && ctx.purgeTags !== undefined) {
      try {
        // The answer is read, not assumed: Mallok resolves, rather than
        // rejects, when a purge was not attempted or was turned down.
        const answer = await ctx.purgeTags(
          result.changedProductGroups.map(productCacheTag),
        );
        if (purgeOutcome(answer) === 'done') {
          purged = result.changedProductGroups.length;
        }
      } catch {
        purged = 0;
      }
    }
    return {
      kind: 'repriced',
      updated: result.updated,
      skipped: result.skipped,
      manual: result.manual,
      purged,
      done: result.nextCursor === null,
    };
  }

  // 4. A rate refresh, when one is due.
  if (
    elapsed(state.get(STATE_KEYS.ratesAttemptedAt), now) >= RATES_INTERVAL_MS
  ) {
    // Recorded before the fetch: a source that is down must not be retried
    // every minute.
    await setStateStatement(
      db,
      STATE_KEYS.ratesAttemptedAt,
      now.toISOString(),
      now,
    ).run();

    try {
      const { date, ratesFromEur } = await fetchEcbRates(deps.fetch ?? fetch);
      const rates = ratesFromBase(ratesFromEur, BASE_CURRENCY, CURRENCIES);
      const stored = await readRates(db);

      // A snapshot for a date already stored changes nothing, so it starts no
      // repricing run — the ECB repeats Friday's figures all weekend.
      const isNew = stored.referenceDate !== date;
      const statements = storeRatesStatements(db, {
        rates,
        referenceDate: date,
        source: 'ecb',
        now,
      });
      if (isNew) {
        statements.push(
          setStateStatement(db, STATE_KEYS.repriceCursor, '', now),
        );
      }
      if (statements.length > 0) {
        await db.batch(statements);
      }
      return { kind: 'rates_refreshed', referenceDate: date, repricing: isNew };
    } catch (error) {
      // Not getting rates is routine — networks wobble. The previous snapshot
      // stays in place: a failure must never distort a price. The message
      // carries no request context, so nothing personal reaches the logs.
      return {
        kind: 'rates_failed',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // 5. Housekeeping.
  if (
    elapsed(state.get(STATE_KEYS.cartsCleanedAt), now) >=
    CART_CLEANUP_INTERVAL_MS
  ) {
    const deleted = await deleteExpiredCarts(db, now, CART_CLEANUP_LIMIT);
    await setStateStatement(
      db,
      STATE_KEYS.cartsCleanedAt,
      now.toISOString(),
      now,
    ).run();
    return { kind: 'carts_cleaned', deleted };
  }

  return { kind: 'idle' };
}
