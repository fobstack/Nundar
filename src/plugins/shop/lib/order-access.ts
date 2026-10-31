/**
 * The secret in a buyer's link to their order.
 *
 * The shop has no buyer accounts (design §20, D2): what lets a buyer see
 * their order is a link — Stripe's return to the shop, and the one in every
 * email — whose secret is an HMAC of the order's id. The order number alone
 * is not enough: it is printed on a parcel and read out on the phone, and
 * says nothing a stranger could not guess from a date.
 *
 * An HMAC rather than a random token stored with the order, because the
 * emails are sent by a job, later, with no request in hand: the job has to
 * be able to write the link again, and a stored token would have to be kept
 * readable for that. The key is made once, at random, and kept in the shop's
 * state — which a site export leaves behind — so an export opens no order's
 * page, and a site restored from one gives its old links up.
 */

import { STATE_KEYS } from './state.js';

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * The key every order's link is signed with: made the first time it is
 * needed, and the same ever after. Two requests that both find none both
 * offer one, and both read back whichever was stored first.
 */
export async function orderLinkKey(
  db: D1Database,
  now: Date,
): Promise<CryptoKey> {
  const offered = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const [, stored] = await db.batch<{ value: string }>([
    db
      .prepare(
        `INSERT INTO p_shop_state (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO NOTHING`,
      )
      .bind(STATE_KEYS.orderLinkKey, offered, now.toISOString()),
    db
      .prepare('SELECT value FROM p_shop_state WHERE key = ?')
      .bind(STATE_KEYS.orderLinkKey),
  ]);
  const value = (stored?.results ?? [])[0]?.value;
  if (value === undefined) {
    throw new Error('The order link key could not be stored');
  }
  return importKey(value);
}

/**
 * The key, if one has been made, for a page that only reads: a site with
 * no key has placed no order, so no link can open anything yet.
 */
export async function existingOrderLinkKey(
  db: D1Database,
): Promise<CryptoKey | null> {
  const row = await db
    .prepare('SELECT value FROM p_shop_state WHERE key = ?')
    .bind(STATE_KEYS.orderLinkKey)
    .first<{ value: string }>();
  return row === null ? null : importKey(row.value);
}

function importKey(value: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(value),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** The secret in one order's link: 43 characters of base64url. */
export async function orderToken(
  key: CryptoKey,
  orderId: string,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`order:${orderId}`),
  );
  return base64url(new Uint8Array(signature));
}

/** What a token looks like, before anything is computed for it. */
export function isOrderToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

/**
 * Whether a token opens an order. Compared in time that does not depend on
 * where the two first differ, so that a visitor learns nothing from how long
 * a wrong guess took.
 */
export async function tokenOpens(
  key: CryptoKey,
  orderId: string,
  token: string,
): Promise<boolean> {
  if (!isOrderToken(token)) {
    return false;
  }
  const expected = await orderToken(key, orderId);
  let difference = expected.length ^ token.length;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ token.charCodeAt(index);
  }
  return difference === 0;
}
