/**
 * What the shop does with a delivery from Stripe.
 *
 * The webhook is the only trustworthy word on whether an order was paid. A
 * browser closes, or a connection drops, right after payment all the time, so
 * the buyer coming back to a "thank you" page proves nothing.
 *
 * This is the decision and nothing else: it takes the raw body, the signature
 * header and the signing secret, and says what happened and which HTTP status
 * to answer with. A route reads the request, calls this, and answers.
 *
 * **The status is chosen by one question: could delivering this again change
 * the result?** Stripe delivers an event again, for up to three days,
 * whenever the answer is not a 2xx. A database that could not be reached is
 * worth another try, and answers 5xx. Nothing else is: an event this shop
 * does not act on, a payment for an order it does not have, a payment for an
 * order that was cancelled. Those answer 200, and what a person has to do
 * about them is written down — in the outbox, or in the outcome a route logs
 * — rather than signalled by failing for three days.
 *
 * **What follows a payment is not decided from the outcome returned here.**
 * The email to the buyer is owed from the outbox row the payment's own batch
 * wrote. A route drains the order's outbox after any outcome that names an
 * order, `duplicate` included: a duplicate is what a redelivery looks like
 * after a first attempt that paid the order and then died.
 */

import { z } from 'zod';
import type { OrderStatus } from './order-state.js';
import {
  markOrderPaid,
  OrderNotFoundError,
  PAYMENT_EVENT_TYPE,
} from './orders.js';
import { verifyStripeSignature } from './stripe-signature.js';

export type WebhookOutcome =
  /** Not from Stripe, or not readable. Nothing was done. */
  | { readonly status: 400; readonly kind: 'rejected'; readonly reason: string }
  /** Genuine, and nothing this shop acts on. */
  | { readonly status: 200; readonly kind: 'ignored'; readonly reason: string }
  /**
   * A payment naming an order this database does not have: made through
   * another shop on the same Stripe account, or for an order that was lost.
   * Worth a warning in the logs, and no retry could find the order.
   */
  | {
      readonly status: 200;
      readonly kind: 'unmatched';
      readonly orderId: string;
    }
  /** The order was paid by this delivery. */
  | {
      readonly status: 200;
      readonly kind: 'paid';
      readonly orderId: string;
      readonly availabilityChanged: readonly string[];
    }
  /** Paid for, and the stock had gone. A person has to refund it. */
  | {
      readonly status: 200;
      readonly kind: 'oversold';
      readonly orderId: string;
    }
  /**
   * The order could not take a payment: it was cancelled, or another payment
   * had settled it. The payment is on record for a person to refund.
   */
  | {
      readonly status: 200;
      readonly kind: 'refused';
      readonly orderId: string;
      readonly orderStatus: OrderStatus;
    }
  /** This payment had been dealt with before. */
  | {
      readonly status: 200;
      readonly kind: 'duplicate';
      readonly orderId: string;
      readonly orderStatus: OrderStatus;
    }
  /** Could not be processed now; Stripe should deliver it again. */
  | {
      readonly status: 500;
      readonly kind: 'failed';
      readonly orderId: string;
      readonly reason: string;
    };

const envelopeSchema = z.object({
  id: z.string().min(1).max(255),
  type: z.string().min(1).max(255),
});

const paymentSchema = z.object({
  data: z.object({
    object: z.object({
      id: z.string().min(1).max(255),
      metadata: z.record(z.string(), z.string()).nullish(),
    }),
  }),
});

const MALFORMED: WebhookOutcome = {
  status: 400,
  kind: 'rejected',
  reason: 'Malformed payload',
};

export async function handleStripeWebhook(
  db: D1Database,
  input: {
    /** The body exactly as received. Never a parsed and re-serialised copy. */
    readonly rawBody: string;
    /** The `Stripe-Signature` header; empty when the request had none. */
    readonly signatureHeader: string;
    readonly secret: string;
    readonly now: Date;
  },
): Promise<WebhookOutcome> {
  const verification = await verifyStripeSignature(
    input.rawBody,
    input.signatureHeader,
    input.secret,
    Math.floor(input.now.getTime() / 1000),
  );
  if (!verification.ok) {
    return { status: 400, kind: 'rejected', reason: verification.reason };
  }

  let json: unknown;
  try {
    json = JSON.parse(input.rawBody);
  } catch {
    return MALFORMED;
  }
  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success) {
    return MALFORMED;
  }

  if (envelope.data.type !== PAYMENT_EVENT_TYPE) {
    return { status: 200, kind: 'ignored', reason: 'Event type not handled' };
  }

  // A payment event that does not carry a payment is not something to wave
  // through: it would be a real payment swallowed in silence. Refusing it
  // keeps it in Stripe's list of failed deliveries, where it can be seen.
  const payment = paymentSchema.safeParse(json);
  if (!payment.success) {
    return MALFORMED;
  }
  const orderId = payment.data.data.object.metadata?.order_id ?? '';
  if (orderId === '') {
    // A payment with no order id was not made through this shop's checkout:
    // the same Stripe account may also take payments for an invoice or a
    // payment link. It is not a failure, and retrying would never change it.
    return {
      status: 200,
      kind: 'ignored',
      reason: 'Payment carries no order id',
    };
  }

  try {
    const result = await markOrderPaid(db, {
      orderId,
      eventId: envelope.data.id,
      paymentIntentId: payment.data.data.object.id,
      now: input.now,
    });

    switch (result.outcome) {
      case 'paid':
        return {
          status: 200,
          kind: 'paid',
          orderId,
          availabilityChanged: result.availabilityChanged,
        };
      case 'oversold':
        // The money has been taken and the goods are not there. Delivering
        // the event again cannot make stock appear.
        return { status: 200, kind: 'oversold', orderId };
      case 'refused':
        return {
          status: 200,
          kind: 'refused',
          orderId,
          orderStatus: result.status,
        };
      case 'duplicate':
        return {
          status: 200,
          kind: 'duplicate',
          orderId,
          orderStatus: result.status,
        };
    }
  } catch (error) {
    if (error instanceof OrderNotFoundError) {
      return { status: 200, kind: 'unmatched', orderId };
    }
    // The reason is for the logs. It names the order by id and never carries
    // an email address or a postal address.
    return {
      status: 500,
      kind: 'failed',
      orderId,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
