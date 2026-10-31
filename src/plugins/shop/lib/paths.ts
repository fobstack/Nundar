/**
 * The addresses of the shop's own routes.
 *
 * Mallok mounts a plugin's routes under `/_mallok/p/<plugin id>`, and reads a
 * language from the segment after it: `/_mallok/p/shop/de/cart` is the route
 * `cart` in German. The default language has no segment, as on the rest of
 * the site. The cart cookie is scoped to the part every language shares.
 */

import { CART_COOKIE_PATH } from './cookie.js';

/** The cart page. */
export const CART_ROUTE = 'cart';

/** Where every form that changes the cart posts. */
export const CART_UPDATE_ROUTE = 'cart/update';

/** Where the cart page's form posts to send the cart as an inquiry. */
export const CART_INQUIRY_ROUTE = 'cart/inquiry';

/** The checkout page: where the goods go, and the button that pays. */
export const CHECKOUT_ROUTE = 'checkout';

/** Where the checkout page's form posts to place the order. */
export const CHECKOUT_PLACE_ROUTE = 'checkout/place';

/** An order's own page, at `order/<order number>`. */
export const ORDER_ROUTE = 'order';

/** Where Stripe delivers its events. Not a page: no language segment. */
export const STRIPE_WEBHOOK_ROUTE = 'stripe/webhook';

export function shopPath(
  route: string,
  locale: string,
  defaultLocale: string,
): string {
  return locale === defaultLocale
    ? `${CART_COOKIE_PATH}/${route}`
    : `${CART_COOKIE_PATH}/${locale}/${route}`;
}

/**
 * The buyer's link to their order, whole: the site's address, the order's
 * page in the language it was placed in, and the secret that opens it.
 * An order number is letters, digits and hyphens, so it needs no escaping.
 */
export function orderLink(input: {
  readonly origin: string;
  readonly orderNo: string;
  readonly token: string;
  readonly locale: string;
  readonly defaultLocale: string;
}): string {
  const path = shopPath(
    `${ORDER_ROUTE}/${encodeURIComponent(input.orderNo)}`,
    input.locale,
    input.defaultLocale,
  );
  return `${input.origin}${path}?k=${encodeURIComponent(input.token)}`;
}
