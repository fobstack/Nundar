import type { Currency } from "@/config/currency";

/**
 * A Stripe REST client built on fetch, with no SDK.
 *
 * The official Node SDK needs adapting to run on Workers, and this project uses
 * exactly two endpoints — create a PaymentIntent, and refund one. Calling REST
 * directly costs fewer dependencies and gives more control, which matters
 * doubly for a template other people will fork.
 */
const API_BASE = "https://api.stripe.com/v1";

export type StripeError = { error: string };

function encodeForm(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

async function stripeRequest<T>(
  secretKey: string,
  path: string,
  body: Record<string, string>,
  idempotencyKey?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  // The idempotency key is what stops a retry from charging twice
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  const response = await fetchImpl(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: encodeForm(body),
  });

  const payload = (await response.json()) as
    | T
    | { error?: { message?: string } };

  if (!response.ok) {
    const message =
      (payload as { error?: { message?: string } }).error?.message ??
      `Stripe request failed with status ${response.status}`;
    // Never put the key or the full response in the error, or it lands in the logs
    throw new Error(`Stripe: ${message}`);
  }

  return payload as T;
}

export type PaymentIntent = {
  id: string;
  client_secret: string;
  status: string;
};

/**
 * Create a PaymentIntent.
 *
 * The amount always comes from the server-side calculation and never from the
 * client. Accepting a client-supplied amount would let anyone buy anything for
 * a penny.
 */
export async function createPaymentIntent(
  secretKey: string,
  input: {
    amountMinor: number;
    currency: Currency;
    orderId: string;
    orderNo: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<PaymentIntent> {
  return stripeRequest<PaymentIntent>(
    secretKey,
    "/payment_intents",
    {
      amount: String(input.amountMinor),
      currency: input.currency.toLowerCase(),
      "automatic_payment_methods[enabled]": "true",
      "metadata[order_id]": input.orderId,
      "metadata[order_no]": input.orderNo,
    },
    // Resubmitting the same order yields the same PaymentIntent
    `order:${input.orderId}`,
    fetchImpl,
  );
}

export type Refund = { id: string; status: string };

export async function createRefund(
  secretKey: string,
  input: { paymentIntentId: string; reason?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<Refund> {
  const body: Record<string, string> = {
    payment_intent: input.paymentIntentId,
  };
  if (input.reason) {
    body.reason = input.reason;
  }

  return stripeRequest<Refund>(
    secretKey,
    "/refunds",
    body,
    `refund:${input.paymentIntentId}`,
    fetchImpl,
  );
}

export type CheckoutSession = {
  id: string;
  url: string;
};

/**
 * Open a Stripe hosted Checkout session.
 *
 * Compared with embedded Elements, the hosted page needs no client-side
 * dependency, and card numbers stay off our servers either way. The cost is
 * that the buyer leaves for stripe.com to pay, which weakens brand continuity.
 *
 * The critical detail: order_id must go into payment_intent_data.metadata.
 * Without it, a payment_intent.succeeded webhook cannot be matched to an order.
 */
export async function createCheckoutSession(
  secretKey: string,
  input: {
    amountMinor: number;
    currency: Currency;
    orderId: string;
    orderNo: string;
    productName: string;
    successUrl: string;
    cancelUrl: string;
    customerEmail?: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<CheckoutSession> {
  const body: Record<string, string> = {
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": input.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(input.amountMinor),
    "line_items[0][price_data][product_data][name]": input.productName,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    "metadata[order_id]": input.orderId,
    "metadata[order_no]": input.orderNo,
    "payment_intent_data[metadata][order_id]": input.orderId,
    "payment_intent_data[metadata][order_no]": input.orderNo,
  };

  if (input.customerEmail) {
    body.customer_email = input.customerEmail;
  }

  return stripeRequest<CheckoutSession>(
    secretKey,
    "/checkout/sessions",
    body,
    `checkout:${input.orderId}`,
    fetchImpl,
  );
}
