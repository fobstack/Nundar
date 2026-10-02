/**
 * The cart cookie.
 *
 * Scoped to the plugin's own path on purpose. Mallok's edge cache is bypassed
 * for any public request that carries a cookie, so a cart cookie sent with
 * every page view would switch caching off for every visitor who had ever
 * added something. Under `/_mallok/p/shop` it reaches the shop's routes and
 * nothing else.
 */

import { CART_TTL_SECONDS, isCartId } from './cart.js';

export const CART_COOKIE = 'nundar_cart';

export const CART_COOKIE_PATH = '/_mallok/p/shop';

/** Reads the cart id from a request; null when absent or malformed. */
export function readCartCookie(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (header === null) {
    return null;
  }
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() === CART_COOKIE) {
      const value = part.slice(separator + 1).trim();
      return isCartId(value) ? value : null;
    }
  }
  return null;
}

/**
 * The `Set-Cookie` value for a cart id.
 *
 * `HttpOnly`: no script needs it. `SameSite=Lax`: a form on the site's own
 * product page still sends it, a cross-site POST does not. `Secure` is left
 * off only for plain-HTTP local development, where a browser would otherwise
 * drop the cookie.
 */
export function cartCookieHeader(cartId: string, secure: boolean): string {
  return [
    `${CART_COOKIE}=${cartId}`,
    `Path=${CART_COOKIE_PATH}`,
    `Max-Age=${CART_TTL_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}
