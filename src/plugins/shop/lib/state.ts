/**
 * The plugin's small key-value state (`p_shop_state`).
 *
 * It exists for the scheduled work, which runs once a minute and has to
 * remember across ticks when rates were last tried and where a chunked
 * repricing run has got to.
 */

export const STATE_KEYS = {
  /** ISO time of the last attempt to fetch exchange rates. */
  ratesAttemptedAt: 'rates_attempted_at',
  /** The variant id a repricing run has reached; absent when none is running. */
  repriceCursor: 'reprice_cursor',
  /** ISO time expired carts were last cleared. */
  cartsCleanedAt: 'carts_cleaned_at',
} as const;

export async function readState(
  db: D1Database,
): Promise<ReadonlyMap<string, string>> {
  const { results } = await db
    .prepare('SELECT key, value FROM p_shop_state')
    .all<{ key: string; value: string }>();
  return new Map(results.map((row) => [row.key, row.value]));
}

export function setStateStatement(
  db: D1Database,
  key: string,
  value: string,
  now: Date,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO p_shop_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET
         value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value, now.toISOString());
}

export function clearStateStatement(
  db: D1Database,
  key: string,
): D1PreparedStatement {
  return db.prepare('DELETE FROM p_shop_state WHERE key = ?').bind(key);
}
