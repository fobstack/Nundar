/**
 * The Stripe calls the shop makes, over `fetch`, with no SDK.
 *
 * Opening a hosted Checkout session, expiring one, refunding a payment, and —
 * when Stripe calculates tax — creating the customer the tax is worked out
 * from. Calling the REST API directly keeps a vendor SDK out of the Worker,
 * which matters twice over for code other people deploy as their own.
 *
 * Every request names the API version it was written against, so a Stripe
 * account set to a newer default cannot change what a field means under it.
 */

import type { Currency } from './currency.js';

const API_BASE = 'https://api.stripe.com/v1';

/**
 * The version this file and the webhook were written and checked against
 * (2026-10-31). The webhook endpoint a seller creates is to be set to the
 * same one, so that the events it sends have the shape the webhook reads.
 */
export const STRIPE_API_VERSION = '2026-10-28.endive';

/** How long a Checkout session takes payment: one hour (design §20, D9). */
export const CHECKOUT_LIFETIME_MS = 60 * 60 * 1000;

/**
 * The most Stripe can charge in one payment by every method checkout offers,
 * in minor units: eight digits, the limit for payments that are not by card,
 * which is the strictest that applies.
 */
export const MAX_CHARGE_MINOR = 99_999_999;

/** The least Stripe charges, by currency, in minor units. */
export const MIN_CHARGE_MINOR: Readonly<Record<Currency, number>> = {
  USD: 50,
  EUR: 50,
  GBP: 30,
};

/** Checkout's limit on the lines of one session in payment mode. */
export const MAX_CHECKOUT_LINES = 100;

/** The languages a Checkout page is offered in that the shop also speaks. */
const CHECKOUT_LOCALES = new Set(['en', 'de', 'fr', 'es']);

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

/** A request Stripe answered with an error. */
export class StripeRequestError extends Error {
  /** The HTTP status Stripe answered with; 0 when nothing came back. */
  readonly status: number;
  /** Stripe's error code, when it gave one. */
  readonly code: string | null;

  constructor(payload: unknown, status: number) {
    super(describeFailure(payload, status));
    this.name = 'StripeRequestError';
    this.status = status;
    this.code = identifier((payload as StripeErrorBody | null)?.error?.code);
  }
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
      'Stripe-Version': STRIPE_API_VERSION,
      // What stops a retried request from charging, or refunding, twice.
      'Idempotency-Key': idempotencyKey,
    },
    body: new URLSearchParams(body).toString(),
  });

  // A proxy's outage page is HTML, not Stripe's JSON; that is a failure to
  // report, not a parse error to crash on.
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok || payload === null) {
    throw new StripeRequestError(payload, response.status);
  }

  return payload as T;
}

export interface CheckoutSession {
  readonly id: string;
  /** Where to send the buyer to pay. */
  readonly url: string;
}

/** One line of an order, as the buyer will see it on Stripe's page. */
export interface CheckoutLine {
  readonly name: string;
  readonly sku: string;
  readonly unitPriceMinor: number;
  readonly quantity: number;
}

/** A whole number of minor units Stripe can be asked for, or not. */
function isAmount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Opens a Stripe-hosted Checkout session for an order.
 *
 * The hosted page needs no client-side code, and card numbers never reach
 * this Worker. The cost is that the buyer leaves the site to pay.
 *
 * Every amount is the order's, as the server stored it — each line at its
 * snapshot price, and shipping as one fixed option named after its zone —
 * so nothing a client sent takes part in what is charged, and Stripe's page
 * shows what the order holds. Stripe's own currency conversion is switched
 * off: the buyer pays what the shop's page said, in the shop's currency.
 *
 * Only payment methods that settle at once are offered (design §20, D3):
 * cards, which take in Apple Pay and Google Pay, and Link. A method that
 * settles days later would leave the stock to go meanwhile.
 *
 * The order id goes into `payment_intent_data.metadata` as well as the
 * session's own metadata. The webhook receives `payment_intent.succeeded`,
 * and the intent's metadata is the only way it can find the order; the
 * session's is how `checkout.session.expired` finds it.
 */
export async function createCheckoutSession(
  secretKey: string,
  input: {
    readonly orderId: string;
    readonly orderNo: string;
    readonly currency: Currency;
    readonly lines: readonly CheckoutLine[];
    readonly shipping: { readonly label: string; readonly amountMinor: number };
    readonly successUrl: string;
    readonly cancelUrl: string;
    /** The language of the page the buyer came from. */
    readonly locale: string;
    readonly expiresAt: Date;
    /** Prefills the address on Stripe's page. Not sent with a customer. */
    readonly customerEmail?: string;
    /**
     * With Stripe calculating tax: the customer whose shipping address the
     * tax is worked out from (`createTaxCustomer`). Absent, no tax.
     */
    readonly taxCustomerId?: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<CheckoutSession> {
  const { lines } = input;
  if (lines.length === 0 || lines.length > MAX_CHECKOUT_LINES) {
    throw new Error(
      `A Checkout session takes 1 to ${MAX_CHECKOUT_LINES} lines`,
    );
  }
  const goods = lines.reduce(
    (sum, line) => sum + line.unitPriceMinor * line.quantity,
    0,
  );
  // Stripe is never asked to charge nothing. A session for a total of zero
  // creates no payment intent, so `payment_intent.succeeded` would never
  // arrive and the order would wait for ever.
  if (
    !lines.every(
      (line) =>
        isAmount(line.unitPriceMinor) &&
        Number.isInteger(line.quantity) &&
        line.quantity > 0,
    ) ||
    !isAmount(input.shipping.amountMinor) ||
    goods + input.shipping.amountMinor <= 0
  ) {
    throw new Error(
      'A Checkout session needs a positive amount in whole minor units',
    );
  }

  const currency = input.currency.toLowerCase();
  const taxed = input.taxCustomerId !== undefined;
  const body: Record<string, string> = {
    mode: 'payment',
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    expires_at: String(Math.floor(input.expiresAt.getTime() / 1000)),
    locale: CHECKOUT_LOCALES.has(input.locale) ? input.locale : 'auto',
    'adaptive_pricing[enabled]': 'false',
    'allowed_payment_method_types[0]': 'card',
    'allowed_payment_method_types[1]': 'link',
    client_reference_id: input.orderNo,
    'metadata[order_id]': input.orderId,
    'metadata[order_no]': input.orderNo,
    'payment_intent_data[metadata][order_id]': input.orderId,
    'payment_intent_data[metadata][order_no]': input.orderNo,
    'shipping_options[0][shipping_rate_data][type]': 'fixed_amount',
    'shipping_options[0][shipping_rate_data][display_name]':
      input.shipping.label.slice(0, 100),
    'shipping_options[0][shipping_rate_data][fixed_amount][amount]': String(
      input.shipping.amountMinor,
    ),
    'shipping_options[0][shipping_rate_data][fixed_amount][currency]': currency,
  };
  lines.forEach((line, index) => {
    const at = `line_items[${index}]`;
    body[`${at}[quantity]`] = String(line.quantity);
    body[`${at}[price_data][currency]`] = currency;
    body[`${at}[price_data][unit_amount]`] = String(line.unitPriceMinor);
    body[`${at}[price_data][product_data][name]`] =
      `${line.name} (${line.sku})`;
    if (taxed) {
      // The shop's prices are without tax: Stripe adds it on top.
      body[`${at}[price_data][tax_behavior]`] = 'exclusive';
    }
  });

  if (taxed) {
    body['automatic_tax[enabled]'] = 'true';
    body.customer = input.taxCustomerId;
    body['shipping_options[0][shipping_rate_data][tax_behavior]'] = 'exclusive';
    // Stripe's own code for shipping.
    body['shipping_options[0][shipping_rate_data][tax_code]'] = 'txcd_92010001';
  } else if (input.customerEmail !== undefined) {
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

/** Where an order goes, as Stripe's address fields name its parts. */
export interface StripeAddress {
  readonly recipient: string;
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  readonly region?: string;
  readonly postalCode: string;
  readonly country: string;
}

function addressFields(
  prefix: string,
  address: StripeAddress,
): Record<string, string> {
  const fields: Record<string, string> = {
    [`${prefix}[line1]`]: address.line1,
    [`${prefix}[city]`]: address.city,
    [`${prefix}[postal_code]`]: address.postalCode,
    [`${prefix}[country]`]: address.country,
  };
  if (address.line2 !== undefined && address.line2 !== '') {
    fields[`${prefix}[line2]`] = address.line2;
  }
  if (address.region !== undefined && address.region !== '') {
    fields[`${prefix}[state]`] = address.region;
  }
  return fields;
}

/**
 * Creates the Stripe customer an order's tax is calculated from, when the
 * shop has Stripe calculate tax.
 *
 * Checkout works tax out from a customer's shipping address when it collects
 * none itself. Giving it the address the buyer already entered here means
 * the tax is for where the goods are going, and the buyer types it once.
 * One customer per order, keyed on the order: the shop has no buyer
 * accounts to attach one to.
 */
export async function createTaxCustomer(
  secretKey: string,
  input: {
    readonly orderId: string;
    readonly email: string;
    readonly company: string;
    readonly address: StripeAddress;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<{ readonly id: string }> {
  return stripeRequest<{ id: string }>(
    secretKey,
    '/customers',
    {
      email: input.email,
      name: input.company.slice(0, 256),
      'shipping[name]': input.address.recipient,
      ...addressFields('shipping[address]', input.address),
      // "Required if calculating taxes."
      ...addressFields('address', input.address),
      'metadata[order_id]': input.orderId,
    },
    `customer:${input.orderId}`,
    fetchImpl,
  );
}

/**
 * Expires an open Checkout session, so that it can no longer be paid: done
 * before an order is cancelled, never after.
 *
 * A session that is no longer open — paid, or expired already — is refused
 * by Stripe; that is reported as `not_open` for the caller to look into the
 * order, not thrown.
 */
export async function expireCheckoutSession(
  secretKey: string,
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<'expired' | 'not_open'> {
  try {
    await stripeRequest(
      secretKey,
      `/checkout/sessions/${encodeURIComponent(sessionId)}/expire`,
      {},
      `expire:${sessionId}`,
      fetchImpl,
    );
    return 'expired';
  } catch (error) {
    if (
      error instanceof StripeRequestError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 401 &&
      error.status !== 429
    ) {
      return 'not_open';
    }
    throw error;
  }
}

export interface Refund {
  readonly id: string;
  readonly status: string;
}

/** The reasons Stripe accepts for a refund. */
export type RefundReason = 'duplicate' | 'fraudulent' | 'requested_by_customer';

/**
 * Refunds a payment. No amount is sent, so the whole payment is refunded
 * (design §20, D11).
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
