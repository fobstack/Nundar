/**
 * Password hashing with WebCrypto's PBKDF2-SHA256.
 *
 * Chosen over Argon2id for one reason: no dependency. Argon2 on Workers means
 * pulling in a WASM library, and this project ships as an open-source template
 * where every dependency is one more thing an adopter has to trust. PBKDF2 with
 * a high enough iteration count, combined with login rate limiting, is adequate
 * for a handful of admin accounts logging in occasionally.
 *
 * The iteration count is bounded by the platform, not by OWASP. Cloudflare's
 * production WebCrypto refuses PBKDF2 above 100,000 iterations outright
 * ("iteration counts above 100000 are not supported"), so OWASP's 600,000 — and
 * the 210,000 this file used to set — cannot run on Workers at all. The local
 * workerd does not enforce that ceiling, which is how 210,000 passed every test
 * here while sign-in could never succeed in production.
 *
 * 50,000 rather than the 100,000 maximum because of CPU: measured on a real
 * account at about 10 ms against about 35 ms, and the Workers Free plan allows
 * 10 ms of CPU per request. Login rate limiting (five attempts, then a
 * fifteen-minute lockout) carries the rest of the defence.
 */
const SCHEME = "pbkdf2-sha256";
const ITERATIONS = 50_000;

/** The most PBKDF2 iterations Cloudflare's production WebCrypto will run */
const PLATFORM_MAX_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    KEY_BITS,
  );

  return new Uint8Array(bits);
}

/** Compare two equal-length byte strings in time independent of their contents */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/** Produce a self-describing hash string: scheme$iterations$salt$digest */
export async function hashPassword(password: string): Promise<string> {
  if (!password) {
    throw new Error("Password must not be empty");
  }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const digest = await derive(password, salt, ITERATIONS);

  return [SCHEME, ITERATIONS, toBase64(salt), toBase64(digest)].join("$");
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== SCHEME) {
    // An unrecognised stored format is a failed verification, not an exception:
    // throwing would turn a storage detail into a 500 that leaks it
    return false;
  }

  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) {
    return false;
  }

  // Refused before deriving, so local development behaves as production does:
  // there the derivation throws, and a hash that verifies locally but never in
  // production is exactly how this went unnoticed. The caller answers as for a
  // wrong password, so the account's existence is not revealed; the log line is
  // for the operator and carries nothing that identifies the account.
  if (iterations > PLATFORM_MAX_ITERATIONS) {
    console.warn(
      `[auth] a stored password hash uses ${iterations} PBKDF2 iterations, above the Workers ceiling of ${PLATFORM_MAX_ITERATIONS}, and can never verify. Recreate the account with \`pnpm admin:create <email> --remote\`.`,
    );
    return false;
  }

  try {
    const salt = fromBase64(parts[2]);
    const expected = fromBase64(parts[3]);
    const actual = await derive(password, salt, iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Whether an existing hash should be recomputed with current parameters on next login */
export function needsRehash(stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== SCHEME) {
    return true;
  }
  return Number(parts[1]) < ITERATIONS;
}
