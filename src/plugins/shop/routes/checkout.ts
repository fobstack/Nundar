/**
 * Checkout's two routes.
 *
 * `GET /_mallok/p/shop/checkout` is the checkout page: the cart as it will
 * be ordered, where it can be shipped, what that costs, and the form that
 * places the order. A country is chosen first, by a form sent with GET — the
 * page has no script — and the page then shows shipping and the total for
 * it, and the order form, which carries that country.
 *
 * `POST /_mallok/p/shop/checkout/place` places the order and sends the buyer
 * to Stripe to pay. It never renders: every answer is a 303, to Stripe's
 * page or back to the checkout page with the kind of reason no order was
 * placed (`?checkout=invalid&field=email`). Nothing a person typed travels
 * in an address.
 *
 * What is ordered is the cart as it is read at the POST, priced then, by the
 * reading the page itself is drawn from; shipping is the rate of the zone the
 * posted country is in. The order is written before Stripe is asked for
 * anything, so that a payment always has an order to land on, and it waits
 * as `pending` until Stripe says it was paid — its stock is taken then, not
 * now (design §11).
 *
 * One open payment per cart: placing the order again — a second tab, a
 * buyer who came back from Stripe's page and changed the cart — first
 * closes the session of any order from the same cart still waiting, so the
 * same goods cannot be paid for twice. A session Stripe has complete is
 * paid, whatever the order says yet — its word may be on its way — and is
 * never closed: the buyer is told their order is being confirmed. The order
 * is then written only if no other from the cart is waiting, which two
 * placements at the same moment cannot both pass, and a placement whose
 * order was closed by another while it opened its session closes that
 * session again rather than send the buyer to it.
 *
 * And a limit per visitor, counted in the order's own write
 * (`MAX_CHECKOUTS_PER_HOUR`): each placement writes an order and asks Stripe
 * for a session, and a public form must not be a way to make either without
 * end. Mallok's rate limit is in front of it, and is best-effort.
 */

import type {
  PluginPageResult,
  PluginRequestContext,
  RouteInput,
} from 'mallok/worker';
import { readCartCurrencyStatement, readCartStatement } from '../lib/cart.js';
import { pricedCartOf } from '../lib/cart-pricing.js';
import {
  type CheckoutForm,
  checkoutFormSchema,
  firstInvalidCheckoutField,
  readCheckout,
  stripeKeys,
  TERMS_ACCEPTED,
  taxModeOf,
  termsPathOf,
} from '../lib/checkout.js';
import {
  CHECKOUT_REFUSALS,
  type CheckoutRefusal,
  checkoutView,
} from '../lib/checkout-view.js';
import { readCartCookie } from '../lib/cookie.js';
import {
  type Currency,
  defaultCurrencyForLocale,
  isCurrency,
} from '../lib/currency.js';
import { orderLinkKey, orderToken } from '../lib/order-access.js';
import { cancelOrder } from '../lib/order-fulfilment.js';
import {
  createPendingOrder,
  OrderNotPlacedError,
  orderNoPrefixOf,
  recordCheckoutSession,
} from '../lib/orders.js';
import {
  CART_ROUTE,
  CHECKOUT_PLACE_ROUTE,
  CHECKOUT_ROUTE,
  orderLink,
  shopPath,
  siteOriginOf,
} from '../lib/paths.js';
import { isCountryCode } from '../lib/shipping.js';
import {
  CHECKOUT_LIFETIME_MS,
  closeCheckoutSession,
  createCheckoutSession,
  createTaxCustomer,
  StripeRequestError,
} from '../lib/stripe-client.js';

/** The most orders one visitor may place in an hour. */
export const MAX_CHECKOUTS_PER_HOUR = 10;

/** The checkout page's address carries a refusal as these parameters. */
export const CHECKOUT_PARAM = 'checkout';
export const CHECKOUT_FIELD_PARAM = 'field';
/** And the country chosen, from its own form. */
export const COUNTRY_PARAM = 'country';

function paths(ctx: PluginRequestContext): {
  checkout: string;
  place: string;
  cart: string;
} {
  const { defaultLocale } = ctx.site;
  return {
    checkout: shopPath(CHECKOUT_ROUTE, ctx.locale, defaultLocale),
    place: shopPath(CHECKOUT_PLACE_ROUTE, ctx.locale, defaultLocale),
    cart: shopPath(CART_ROUTE, ctx.locale, defaultLocale),
  };
}

/** The cart this browser holds: its lines and its currency, in one round trip. */
async function readHeldCart(
  ctx: PluginRequestContext,
  now: Date,
): Promise<{
  cartId: string | null;
  lines: { variantId: string; quantity: number }[];
  currency: Currency;
}> {
  const cartId = readCartCookie(ctx.request);
  const [linesResult, currencyResult] = await ctx.db.batch<
    { variant_id: string; quantity: number } | { currency: string | null }
  >([
    readCartStatement(ctx.db, cartId ?? '', now),
    readCartCurrencyStatement(ctx.db, cartId ?? '', now),
  ]);
  const chosen = (
    (currencyResult?.results ?? []) as { currency: string | null }[]
  )[0]?.currency;
  return {
    cartId,
    lines: (
      (linesResult?.results ?? []) as { variant_id: string; quantity: number }[]
    ).map((row) => ({ variantId: row.variant_id, quantity: row.quantity })),
    currency:
      typeof chosen === 'string' && isCurrency(chosen)
        ? chosen
        : defaultCurrencyForLocale(ctx.locale),
  };
}

/** `GET checkout`: the checkout page. It reads and never writes. */
export async function checkoutPage(
  _input: RouteInput,
  ctx: PluginRequestContext,
): Promise<PluginPageResult> {
  const now = new Date();
  const cart = await readHeldCart(ctx, now);
  // The country asked for, else the one the request came from — a guess the
  // buyer can change, never a decision taken for them.
  const asked = (ctx.url.searchParams.get(COUNTRY_PARAM) ?? '').toUpperCase();
  const country = isCountryCode(asked) ? asked : (ctx.country ?? null);
  const reading = await readCheckout(ctx.db, {
    lines: cart.lines,
    locale: ctx.locale,
    defaultLocale: ctx.site.defaultLocale,
    currency: cart.currency,
    country,
    now,
  });

  const refusedAsked = ctx.url.searchParams.get(CHECKOUT_PARAM);
  const refusedKind = CHECKOUT_REFUSALS.find((kind) => kind === refusedAsked);
  const fieldAsked = ctx.url.searchParams.get(CHECKOUT_FIELD_PARAM) ?? '';
  return {
    view: checkoutView(reading, {
      locale: ctx.locale,
      taxMode: taxModeOf(ctx.settings),
      payments: stripeKeys(ctx.secrets) !== null,
      termsPath: termsPathOf(ctx.settings),
      refused:
        refusedKind === undefined
          ? null
          : {
              kind: refusedKind,
              // Only a field the form has: nothing else from the address
              // reaches the page.
              field:
                refusedKind === 'invalid' &&
                /^[a-z_0-9]{1,20}$/.test(fieldAsked) &&
                fieldAsked !== 'website'
                  ? fieldAsked
                  : '',
            },
      paths: paths(ctx),
    }),
  };
}

/**
 * Closes every order from this cart still waiting for its payment, so that
 * the order about to be placed is the only one that can be paid. Stripe is
 * asked to close a session before its order is cancelled, never after.
 *
 * Answers `paid` when Stripe has one complete: it is not closed and its order
 * is left to its payment, and no new order may be placed. An order with no
 * session yet is another placement's, opening one now: it is cancelled, and
 * that placement closes its session when it finds its order gone.
 *
 * Throws when Stripe could not be asked: an order whose session cannot be
 * closed must not be left open beside a new one.
 */
async function closeEarlierOrders(
  ctx: PluginRequestContext,
  cartId: string,
  secretKey: string,
  now: Date,
): Promise<'closed' | 'paid'> {
  const { results } = await ctx.db
    .prepare(
      `SELECT id, stripe_session_id FROM p_shop_order
       WHERE cart_id = ? AND status = 'pending'
       ORDER BY created_at LIMIT 10`,
    )
    .bind(cartId)
    .all<{ id: string; stripe_session_id: string | null }>();
  for (const row of results) {
    if (
      row.stripe_session_id !== null &&
      (await closeCheckoutSession(secretKey, row.stripe_session_id)) === 'paid'
    ) {
      return 'paid';
    }
    try {
      await cancelOrder(ctx.db, { orderId: row.id, reason: 'replaced', now });
    } catch {
      // Paid, or closed, meanwhile: either way no longer waiting.
    }
  }
  return 'closed';
}

function addressOf(form: CheckoutForm) {
  return {
    recipient: form.recipient,
    line1: form.line1,
    ...(form.line2 === '' ? {} : { line2: form.line2 }),
    city: form.city,
    ...(form.state === '' ? {} : { state: form.state }),
    postalCode: form.postal_code,
    country: form.country,
    ...(form.phone === '' ? {} : { phone: form.phone }),
  };
}

/** `POST checkout/place`: place the order, and send the buyer to pay. */
export async function checkoutPlace(
  input: RouteInput,
  ctx: PluginRequestContext,
): Promise<Response> {
  const now = new Date();
  const routes = paths(ctx);
  const back = (query: Record<string, string>): Response => {
    const search = new URLSearchParams(query).toString();
    return new Response(null, {
      status: 303,
      headers: {
        location:
          search === '' ? routes.checkout : `${routes.checkout}?${search}`,
      },
    });
  };
  const refuse = (
    kind: CheckoutRefusal,
    extra: Record<string, string> = {},
  ): Response => back({ [CHECKOUT_PARAM]: kind, ...extra });

  const parsed = checkoutFormSchema.safeParse(input.fields);
  if (!parsed.success) {
    const field = firstInvalidCheckoutField(parsed.error);
    return refuse(
      'invalid',
      field === null ? {} : { [CHECKOUT_FIELD_PARAM]: field },
    );
  }
  const form = parsed.data;
  const withCountry = { [COUNTRY_PARAM]: form.country };

  // Whatever filled in the field no person sees is answered as if all were
  // well, and nothing is placed: it learns nothing to try differently.
  if (form.website !== '') {
    return back(withCountry);
  }
  if (termsPathOf(ctx.settings) !== '' && form.terms !== TERMS_ACCEPTED) {
    return refuse('invalid', {
      [CHECKOUT_FIELD_PARAM]: 'terms',
      ...withCountry,
    });
  }
  const keys = stripeKeys(ctx.secrets);
  if (keys === null) {
    return refuse('payments_unavailable', withCountry);
  }

  const cart = await readHeldCart(ctx, now);
  if (cart.cartId === null || cart.lines.length === 0) {
    return refuse('empty');
  }
  const reading = await readCheckout(ctx.db, {
    lines: cart.lines,
    locale: ctx.locale,
    defaultLocale: ctx.site.defaultLocale,
    currency: cart.currency,
    country: form.country,
    now,
  });
  const priced = pricedCartOf(reading.facts);
  if (
    reading.problem !== null ||
    reading.quote === null ||
    reading.rate === null ||
    !priced.ok
  ) {
    return refuse(reading.problem ?? 'cart_problem', withCountry);
  }

  try {
    if (
      (await closeEarlierOrders(ctx, cart.cartId, keys.secretKey, now)) ===
      'paid'
    ) {
      return refuse('paid_meanwhile', withCountry);
    }
  } catch (error) {
    logFailure('close_earlier', error);
    return refuse('payments_unavailable', withCountry);
  }

  const taxMode = taxModeOf(ctx.settings);
  const origin = siteOriginOf(ctx.site.domain, ctx.url);
  let order: { id: string; orderNo: string };
  try {
    order = await createPendingOrder(ctx.db, {
      cart: priced,
      locale: ctx.locale,
      email: form.email,
      shippingAddress: addressOf(form),
      shippingMinor: reading.quote.shippingMinor,
      taxMinor: 0,
      now,
      cartId: cart.cartId,
      company: form.company,
      taxId: form.tax_id,
      shippingZone: reading.rate.zoneName,
      taxMode,
      siteOrigin: origin,
      orderNoPrefix: orderNoPrefixOf(ctx.settings.order_no_prefix),
      guard: { ipHash: ctx.ipHash, maxPerHour: MAX_CHECKOUTS_PER_HOUR },
    });
  } catch (error) {
    if (error instanceof OrderNotPlacedError) {
      return refuse(error.reason, withCountry);
    }
    throw error;
  }

  let opened: string | null = null;
  try {
    const token = await orderToken(await orderLinkKey(ctx.db, now), order.id);
    const expiresAt = new Date(now.getTime() + CHECKOUT_LIFETIME_MS);
    const taxCustomer =
      taxMode === 'stripe'
        ? await createTaxCustomer(keys.secretKey, {
            orderId: order.id,
            email: form.email,
            company: form.company,
            address: { ...addressOf(form), region: form.state },
          })
        : null;
    const session = await createCheckoutSession(keys.secretKey, {
      orderId: order.id,
      orderNo: order.orderNo,
      currency: priced.currency,
      lines: priced.lines.map((line) => ({
        name: line.name,
        sku: line.sku,
        unitPriceMinor: line.unitPriceMinor,
        quantity: line.quantity,
      })),
      shipping: {
        label: reading.rate.zoneName,
        amountMinor: reading.quote.shippingMinor,
      },
      successUrl: orderLink({
        origin,
        orderNo: order.orderNo,
        token,
        locale: ctx.locale,
        defaultLocale: ctx.site.defaultLocale,
      }),
      cancelUrl: `${origin}${routes.checkout}?${new URLSearchParams(withCountry).toString()}`,
      locale: ctx.locale,
      expiresAt,
      ...(taxCustomer === null
        ? { customerEmail: form.email }
        : { taxCustomerId: taxCustomer.id }),
    });
    opened = session.id;
    if (!session.url.startsWith('https://')) {
      throw new Error('Stripe answered with no page to pay on');
    }
    // Closed by another placement while this one opened its session: the
    // session must not be paid for an order that is no longer waiting.
    if (
      !(await recordCheckoutSession(ctx.db, {
        orderId: order.id,
        sessionId: session.id,
        expiresAt,
        now,
      }))
    ) {
      throw new OrderNotPlacedError('in_progress');
    }
    console.log(
      JSON.stringify({ event: 'shop_checkout', orderId: order.id, taxMode }),
    );
    return new Response(null, {
      status: 303,
      headers: { location: session.url },
    });
  } catch (error) {
    // A session this placement opened is closed again, whatever went wrong
    // after it was opened.
    if (opened !== null) {
      await closeCheckoutSession(keys.secretKey, opened).catch(
        (closing: unknown) => logFailure('close_opened', closing, order.id),
      );
    }
    if (error instanceof OrderNotPlacedError) {
      return refuse(error.reason, withCountry);
    }
    logFailure('session', error, order.id);
    // Nothing was paid: the order is closed, quietly, and the buyer told
    // that payments are not available now.
    await cancelOrder(ctx.db, {
      orderId: order.id,
      reason: 'failed',
      now,
    }).catch(() => undefined);
    return refuse('payments_unavailable', withCountry);
  }
}

/**
 * One line for the logs. Stripe's failure is described by its identifiers
 * (`stripe-client.ts`); any other by its kind alone, since nothing rules out
 * a message repeating a value that was bound.
 */
function logFailure(stage: string, error: unknown, orderId?: string): void {
  console.log(
    JSON.stringify({
      event: 'shop_checkout_failed',
      stage,
      ...(orderId === undefined ? {} : { orderId }),
      reason:
        error instanceof StripeRequestError
          ? error.message
          : error instanceof Error
            ? error.name
            : 'unknown',
    }),
  );
}
