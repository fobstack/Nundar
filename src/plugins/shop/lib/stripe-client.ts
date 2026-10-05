/**
 * The two Stripe calls the shop makes, over `fetch`, with no SDK.
 *
 * Opening a hosted Checkout session and refunding a payment are the whole
 * surface. Calling the REST API directly keeps a vendor SDK out of the Worker,
 * which matters twice over for code other people deploy as their own.
 */

import type { Currency } from './currency.js';

const API_BASE = 'https://api.stripe.com/v1';

interface StripeErrorBody {
  readonly error?: {
    readonly type?: unknown;
    readonly code?: unknown;
    readonly param?: unknown;
  };
}

/**
 * One of Stripe's own identifiers — an error type, an error code, a parameter
 * name — or nothing. Anything that is not shaped like an identifier is left
 * out rather than passed on.
 */
function identifier(value: unknown): string | null {
  return typeof value === 'string' && /^[\w.[\]-]{1,100}$/.test(value)
    ? value
    : null;
}

/**
 * What went wrong, for the logs, built only from Stripe's identifiers.
 *
 * Never from the free-text message. Stripe writes it for a person, nothing
 * says it will not repeat a value that was sent, and one of the values sent
 * is a buyer's email address. Never the key, and never the whole response.
 */
function describeFailure(payload: unknown, status: number): string {
  const error = (payload as StripeErrorBody | null)?.error;
  const parts = [
    identifier(error?.type),
    identifier(error?.code),
    identifier(error?.param),
  ].filter((part) => part !== null);
  return `Stripe: ${[...parts, `status ${status}`].join(', ')}`;
}

async function stripeRequest<T>(
  secretKey: string,
  path: string,
  body: Readonly<Record<string, string>>,
  idempotencyKey: string,
  fetchImpl: typeof fetch,
): Promise<T> {
  const response = await fetchImpl(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // What stops a retried request from charging, or refunding, twice.
      'Idempotency-Key': idempotencyKey,
    },
    body: new URLSearchParams(body).toString(),
  });

  // A proxy's outage page is HTML, not Stripe's JSON; that is a failure to
  // report, not a parse error to crash on.
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok || payload === null) {
    throw new Error(describeFailure(payload, response.status));
  }

  return payload as T;
}

export interface CheckoutSession {
  readonly id: string;
  /** Where to send the buyer to pay. */
  readonly url: string;
}

/**
 * Opens a Stripe-hosted Checkout session for an order.
 *
 * The hosted page needs no client-side code, and card numbers never reach
 * this Worker. The cost is that the buyer leaves the site to pay.
 *
 * The amount is the order's total as the server computed it — one line item,
 * so nothing a client sent can take part in what is charged.
 *
 * The order id goes into `payment_intent_data.metadata` as well as the
 * session's own metadata. The webhook receives `payment_intent.succeeded`,
 * and the intent's metadata is the only way it can find the order.
 */
export async function createCheckoutSession(
  secretKey: string,
  input: {
    readonly amountMinor: number;
    readonly currency: Currency;
    readonly orderId: string;
    readonly orderNo: string;
    readonly productName: string;
    readonly successUrl: string;
    readonly cancelUrl: string;
    readonly customerEmail?: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<CheckoutSession> {
  // Stripe is never asked to charge nothing. A session for a total of zero
  // creates no payment intent, so `payment_intent.succeeded` would never
  // arrive and the order would wait for ever. An order that costs nothing is
  // confirmed without Stripe, by whoever calls this.
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error(
      'A Checkout session needs a positive amount in whole minor units',
    );
  }

  const body: Record<string, string> = {
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': input.currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(input.amountMinor),
    'line_items[0][price_data][product_data][name]': input.productName,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    'metadata[order_id]': input.orderId,
    'metadata[order_no]': input.orderNo,
    'payment_intent_data[metadata][order_id]': input.orderId,
    'payment_intent_data[metadata][order_no]': input.orderNo,
  };

  if (input.customerEmail !== undefined) {
    body.customer_email = input.customerEmail;
  }

  return stripeRequest<CheckoutSession>(
    secretKey,
    '/checkout/sessions',
    body,
    // A double submit of the same order reuses the session.
    `checkout:${input.orderId}`,
    fetchImpl,
  );
}

export interface Refund {
  readonly id: string;
  readonly status: string;
}

/** The reasons Stripe accepts for a refund. */
export type RefundReason = 'duplicate' | 'fraudulent' | 'requested_by_customer';

/**
 * Refunds a payment. No amount is sent, so the whole payment is refunded.
 *
 * Keyed on the payment intent: asking twice, because the first answer was
 * lost on the way back, must not refund twice.
 */
export async function createRefund(
  secretKey: string,
  input: {
    readonly paymentIntentId: string;
    readonly reason?: RefundReason;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<Refund> {
  const body: Record<string, string> = {
    payment_intent: input.paymentIntentId,
  };
  if (input.reason !== undefined) {
    body.reason = input.reason;
  }

  return stripeRequest<Refund>(
    secretKey,
    '/refunds',
    body,
    `refund:${input.paymentIntentId}`,
    fetchImpl,
  );
}
