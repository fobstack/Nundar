/**
 * The cart, stored in D1.
 *
 * A cart holds variant ids and quantities and **never a price**. Every total
 * is recomputed from current prices whenever the cart is priced; a price
 * stored here would let a client submit whatever amount it liked.
 *
 * D1 rather than KV: on the Workers Free plan KV allows 1,000 writes a day,
 * which a cart exhausts quickly, while D1 allows 100,000 rows written.
 */

export interface CartLine {
  readonly variantId: string;
  readonly quantity: number;
}

/** A cart that nobody touches for this long is deleted. */
export const CART_TTL_SECONDS = 60 * 60 * 24 * 30;

/** Real orders never reach this; anything above it is scripted abuse. */
export const MAX_LINE_QUANTITY = 10_000;

/** A ceiling on lines, so one cart cannot be grown without bound. */
export const MAX_CART_LINES = 100;

const CART_ID_PATTERN = /^[0-9a-f]{32}$/;

/** The id must be unguessable: it is the only credential protecting a cart. */
export function newCartId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isCartId(value: string): boolean {
  return CART_ID_PATTERN.test(value);
}

/** Reads a cart's lines. An unknown or expired cart reads as empty. */
export async function readCart(
  db: D1Database,
  cartId: string,
  now: Date,
): Promise<CartLine[]> {
  if (!isCartId(cartId)) {
    return [];
  }
  const { results } = await readCartStatement(db, cartId, now).all<{
    variant_id: string;
    quantity: number;
  }>();
  return results.map((row) => ({
    variantId: row.variant_id,
    quantity: row.quantity,
  }));
}

export function readCartStatement(
  db: D1Database,
  cartId: string,
  now: Date,
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT l.variant_id AS variant_id, l.quantity AS quantity
       FROM p_shop_cart_line AS l
       JOIN p_shop_cart AS c ON c.id = l.cart_id
       WHERE c.id = ? AND c.expires_at > ?
       ORDER BY l.variant_id`,
    )
    .bind(cartId, now.toISOString());
}

/**
 * Builds the statements that set one line to an absolute quantity and keep
 * the cart alive. A quantity of zero removes the line.
 *
 * The caller validates the quantity first; these statements only persist it.
 */
export function setLineStatements(
  db: D1Database,
  input: {
    readonly cartId: string;
    readonly variantId: string;
    readonly quantity: number;
    readonly currency: string | null;
    readonly locale: string | null;
    readonly now: Date;
  },
): D1PreparedStatement[] {
  const nowIso = input.now.toISOString();
  const expiresIso = new Date(
    input.now.getTime() + CART_TTL_SECONDS * 1000,
  ).toISOString();

  const touchCart = db
    .prepare(
      `INSERT INTO p_shop_cart
         (id, currency, locale, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         currency = COALESCE(excluded.currency, p_shop_cart.currency),
         locale = COALESCE(excluded.locale, p_shop_cart.locale),
         updated_at = excluded.updated_at,
         expires_at = excluded.expires_at`,
    )
    .bind(
      input.cartId,
      input.currency,
      input.locale,
      nowIso,
      nowIso,
      expiresIso,
    );

  const line =
    input.quantity === 0
      ? db
          .prepare(
            'DELETE FROM p_shop_cart_line WHERE cart_id = ? AND variant_id = ?',
          )
          .bind(input.cartId, input.variantId)
      : db
          .prepare(
            `INSERT INTO p_shop_cart_line (cart_id, variant_id, quantity)
             VALUES (?, ?, ?)
             ON CONFLICT (cart_id, variant_id) DO UPDATE SET
               quantity = excluded.quantity`,
          )
          .bind(input.cartId, input.variantId, input.quantity);

  return [touchCart, line];
}

/**
 * Deletes a bounded number of expired carts and their lines.
 *
 * Bounded, because it runs inside the shared once-a-minute cron: whatever is
 * left is picked up on a later tick.
 */
export async function deleteExpiredCarts(
  db: D1Database,
  now: Date,
  limit: number,
): Promise<number> {
  const { results } = await db
    .prepare(
      'SELECT id FROM p_shop_cart WHERE expires_at <= ? ORDER BY expires_at LIMIT ?',
    )
    .bind(now.toISOString(), limit)
    .all<{ id: string }>();
  if (results.length === 0) {
    return 0;
  }
  const ids = JSON.stringify(results.map((row) => row.id));
  await db.batch([
    db
      .prepare(
        'DELETE FROM p_shop_cart_line WHERE cart_id IN (SELECT value FROM json_each(?))',
      )
      .bind(ids),
    db
      .prepare(
        'DELETE FROM p_shop_cart WHERE id IN (SELECT value FROM json_each(?))',
      )
      .bind(ids),
  ]);
  return results.length;
}
