/**
 * Login rate limiting: a KV counter that expires by TTL.
 *
 * The admin is the highest-privilege entry point on the site, and without a
 * limit, password login costs an attacker nothing to brute-force. The counter
 * is keyed on the email address rather than the IP, because changing IP is far
 * cheaper for an attacker than changing which account they are attacking.
 */
export const MAX_ATTEMPTS = 5;

/** Lockout window: how long to wait after hitting the limit. A successful login clears it. */
export const LOCKOUT_SECONDS = 15 * 60;

export function attemptKey(email: string): string {
  return `login:${email.trim().toLowerCase()}`;
}

export async function recordFailedAttempt(
  kv: KVNamespace,
  key: string,
): Promise<number> {
  const current = Number((await kv.get(key)) ?? 0);
  const next = current + 1;

  // Every failure refreshes the TTL, so sustained brute force stays locked out
  // instead of unlocking on a fixed schedule
  await kv.put(key, String(next), { expirationTtl: LOCKOUT_SECONDS });

  return next;
}

export async function isLockedOut(
  kv: KVNamespace,
  key: string,
): Promise<boolean> {
  const current = Number((await kv.get(key)) ?? 0);
  return current >= MAX_ATTEMPTS;
}

export async function clearAttempts(
  kv: KVNamespace,
  key: string,
): Promise<void> {
  await kv.delete(key);
}
