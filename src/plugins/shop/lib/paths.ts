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

export function shopPath(
  route: string,
  locale: string,
  defaultLocale: string,
): string {
  return locale === defaultLocale
    ? `${CART_COOKIE_PATH}/${route}`
    : `${CART_COOKIE_PATH}/${locale}/${route}`;
}
