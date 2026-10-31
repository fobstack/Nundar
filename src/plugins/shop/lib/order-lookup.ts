/**
 * A buyer's way back to their orders, without an account (design §20, D2;
 * §21).
 *
 * The buyer gives the address they ordered with. If any order placed with
 * it was paid for, they are emailed a link that lists those for a day;
 * the answer on the page is the same whether or not there were any, so the
 * form tells nobody who has bought here. The link's secret is 32 random
 * bytes, of which the table keeps only the digest, and the address is never
 * in a link or a log.
 *
 * Two limits, counted inside the write that records a request so that two
 * at once cannot both pass: a visitor may ask a few times an hour, and an
 * address may be sent a few links an hour, whoever asks — which is what
 * keeps the form from being used to fill a buyer's inbox. A request is
 * counted whether or not the address has orders, so the limits say nothing
 * either.
 */

import { z } from 'zod';
import { EMAIL_PATTERN, INQUIRY_LIMITS } from './inquiries.js';
import { PAID_FOR_STATUSES } from './order-state.js';

/**
 * An order is listed, and its address sent a link, only once a payment was
 * taken for it. An order left waiting, or cancelled when its payment page
 * lapsed, carries an address anyone could have typed — as anyone can type it
 * into this form — so counting one would let a stranger have the shop write
 * to an address that never bought anything.
 */
const LISTED = JSON.stringify(PAID_FOR_STATUSES);

/** How long a link opens the list. */
export const ORDER_LOOKUP_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** Requests one visitor may make in an hour. */
export const MAX_LOOKUPS_PER_VISITOR_HOUR = 5;

/** Links one address may be sent in an hour, whoever asks. */
export const MAX_LOOKUPS_PER_ADDRESS_HOUR = 3;

/** The orders a list shows, newest first. */
export const LOOKUP_ORDER_LIMIT = 50;

export const lookupFormSchema = z.object({
  email: z
    .string()
    .default('')
    .transform((value) => value.trim())
    .pipe(z.string().min(3).max(INQUIRY_LIMITS.email).regex(EMAIL_PATTERN)),
  /** A field no person sees. Whatever fills it in is not one. */
  website: z.string().max(500).default(''),
});

/** 32 random bytes as unpadded base64url: the secret in a link. */
export function newLookupToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function isLookupToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** What the table keeps of a token: its SHA-256, in hex. */
export async function lookupDigest(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/**
 * Records a request for a link, if neither limit is reached, and says
 * whether the address has orders to be told of. One batch: the record,
 * conditional on both counts, and the question.
 */
export async function recordLookup(
  db: D1Database,
  input: {
    readonly token: string;
    readonly email: string;
    readonly ipHash: string | null;
    readonly now: Date;
  },
): Promise<
  | { readonly kind: 'recorded'; readonly orders: number }
  | { readonly kind: 'too_many' }
> {
  const email = input.email.toLowerCase();
  const nowIso = input.now.toISOString();
  const hourAgo = new Date(input.now.getTime() - 60 * 60 * 1000).toISOString();
  const [written, counted] = await db.batch<{ n: number }>([
    db
      .prepare(
        `INSERT INTO p_shop_order_link (id, email, ip_hash, created_at, expires_at)
         SELECT ?, ?, ?, ?, ?
         WHERE (SELECT COUNT(*) FROM p_shop_order_link
                WHERE ip_hash IS ? AND created_at > ?) < ?
           AND (SELECT COUNT(*) FROM p_shop_order_link
                WHERE email = ? AND created_at > ?) < ?`,
      )
      .bind(
        await lookupDigest(input.token),
        email,
        input.ipHash,
        nowIso,
        new Date(input.now.getTime() + ORDER_LOOKUP_LIFETIME_MS).toISOString(),
        input.ipHash,
        hourAgo,
        MAX_LOOKUPS_PER_VISITOR_HOUR,
        email,
        hourAgo,
        MAX_LOOKUPS_PER_ADDRESS_HOUR,
      ),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM p_shop_order
         WHERE lower(email) = ?
           AND status IN (SELECT value FROM json_each(?))`,
      )
      .bind(email, LISTED),
  ]);
  if ((written?.meta.changes ?? 0) === 0) {
    return { kind: 'too_many' };
  }
  return { kind: 'recorded', orders: (counted?.results ?? [])[0]?.n ?? 0 };
}

/** The address a link opens, while it is good; null otherwise. */
export async function lookupEmailOf(
  db: D1Database,
  token: string,
  now: Date,
): Promise<string | null> {
  if (!isLookupToken(token)) {
    return null;
  }
  const row = await db
    .prepare(
      'SELECT email FROM p_shop_order_link WHERE id = ? AND expires_at > ?',
    )
    .bind(await lookupDigest(token), now.toISOString())
    .first<{ email: string }>();
  return row?.email ?? null;
}

export interface LookupOrder {
  readonly id: string;
  readonly orderNo: string;
  readonly status: string;
  readonly currency: string;
  readonly totalMinor: number;
  readonly locale: string;
  readonly createdAt: string;
}

/** An address's orders that were paid for, newest first. */
export async function ordersOf(
  db: D1Database,
  email: string,
): Promise<LookupOrder[]> {
  const { results } = await db
    .prepare(
      `SELECT id, order_no, status, currency, total_minor, locale, created_at
       FROM p_shop_order
       WHERE lower(email) = ?
         AND status IN (SELECT value FROM json_each(?))
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(email.toLowerCase(), LISTED, LOOKUP_ORDER_LIMIT)
    .all<{
      id: string;
      order_no: string;
      status: string;
      currency: string;
      total_minor: number;
      locale: string;
      created_at: string;
    }>();
  return results.map((row) => ({
    id: row.id,
    orderNo: row.order_no,
    status: row.status,
    currency: row.currency,
    totalMinor: row.total_minor,
    locale: row.locale,
    createdAt: row.created_at,
  }));
}

/** Deletes links that no longer open anything; how many went. */
export async function deleteExpiredLookups(
  db: D1Database,
  now: Date,
  limit: number,
): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM p_shop_order_link WHERE id IN (
         SELECT id FROM p_shop_order_link WHERE expires_at <= ?
         ORDER BY expires_at LIMIT ?
       )`,
    )
    .bind(now.toISOString(), limit)
    .run();
  return result.meta.changes;
}
