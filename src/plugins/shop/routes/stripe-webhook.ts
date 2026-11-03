/**
 * `POST /_mallok/p/shop/stripe/webhook`: where Stripe delivers its events.
 *
 * A raw-body route: Mallok hands over the bytes as they arrived, because the
 * signature is over them, and passes this route's status back to Stripe
 * unchanged — which is how Stripe decides whether to deliver again. The
 * signature is the only authentication there is, so nothing is read before
 * it has been checked (`handleStripeWebhook`).
 *
 * Until the signing secret is set, every delivery is answered 503: Stripe
 * keeps it and delivers again for three days, so a payment taken in the
 * minutes before a seller finished setting up is not lost.
 *
 * What a delivery owes beyond its own batch — emails, purges — is handed to
 * the order's follow-up job (`order-follow-up.ts`); a job that cannot be
 * queued is taken up by the minute's cron.
 */

import type { PluginRequestContext, RouteInput } from 'mallok/worker';
import { FOLLOW_UP_JOB } from '../lib/order-follow-up.js';
import { stripeSecret } from '../lib/stripe-secrets.js';
import { handleStripeWebhook } from '../lib/stripe-webhook.js';

export async function stripeWebhook(
  _input: RouteInput,
  ctx: PluginRequestContext,
): Promise<Response> {
  const secret = stripeSecret(ctx.secrets, 'stripe_webhook_secret');
  if (secret === '') {
    console.log(
      JSON.stringify({ event: 'shop_stripe_webhook', kind: 'no_secret' }),
    );
    return new Response('The webhook signing secret is not set', {
      status: 503,
    });
  }

  const outcome = await handleStripeWebhook(ctx.db, {
    rawBody: await ctx.request.text(),
    signatureHeader: ctx.request.headers.get('stripe-signature') ?? '',
    secret,
    now: new Date(),
  });

  // The kind, the status and the order's id: nothing of the buyer.
  console.log(
    JSON.stringify({
      event: 'shop_stripe_webhook',
      kind: outcome.kind,
      status: outcome.status,
      ...('orderId' in outcome ? { orderId: outcome.orderId } : {}),
      ...('reason' in outcome ? { reason: outcome.reason } : {}),
    }),
  );

  // Every outcome that names an order of this shop may have left something
  // owed — a duplicate too: it is what a redelivery looks like after a first
  // attempt that paid the order and stopped.
  if (
    outcome.kind === 'paid' ||
    outcome.kind === 'oversold' ||
    outcome.kind === 'refused' ||
    outcome.kind === 'duplicate' ||
    outcome.kind === 'expired'
  ) {
    try {
      await ctx.enqueue(FOLLOW_UP_JOB, { orderId: outcome.orderId });
    } catch {
      console.log(
        JSON.stringify({
          event: 'shop_follow_up_not_queued',
          orderId: outcome.orderId,
        }),
      );
    }
  }

  return new Response(
    outcome.status === 200 ? '{"received":true}' : outcome.kind,
    {
      status: outcome.status,
      headers: {
        'content-type':
          outcome.status === 200 ? 'application/json' : 'text/plain',
      },
    },
  );
}
