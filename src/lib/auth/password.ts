/**
 * Password hashing with WebCrypto's PBKDF2-SHA256.
 *
 * Chosen over Argon2id for one reason: no dependency. Argon2 on Workers means
 * pulling in a WASM library, and this project ships as an open-source template
 * where every dependency is one more thing an adopter has to trust. PBKDF2 with
 * a high enough iteration count, combined with login rate limiting, is adequate
 * for a handful of admin accounts logging in occasionally.
 *
 * 210k iterations follows OWASP's guidance for PBKDF2-HMAC-SHA256. Going higher
 * adds real CPU time to every login, which is a poor trade against the Workers
 * CPU limit.
 */
const SCHEME = "pbkdf2-sha256";
const ITERATIONS = 210_000;
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
