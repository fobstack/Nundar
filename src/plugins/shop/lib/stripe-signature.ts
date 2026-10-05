/**
 * Stripe webhook signature verification, on WebCrypto, without the Stripe SDK.
 *
 * The `Stripe-Signature` header has the form `t=<timestamp>,v1=<hex hmac>`.
 * The signed payload is `<timestamp>.<raw body>`, and the algorithm is
 * HMAC-SHA256 keyed by the endpoint's signing secret.
 *
 * Verification is the webhook's whole reason to exist: without it, anyone can
 * post "payment succeeded" and be sent goods for free. The timestamp is part
 * of what is signed, and the window around it is what limits a replay.
 *
 * It needs the body exactly as Stripe sent it. Parsing the JSON and writing
 * it out again changes the bytes, and the signature no longer matches.
 */

/** Stripe's own libraries allow five minutes between signing and receipt. */
const TOLERANCE_SECONDS = 5 * 60;

export type VerificationResult =
  | { readonly ok: true; readonly timestamp: number }
  | { readonly ok: false; readonly reason: string };

function parseHeader(header: string): {
  timestamp: number | null;
  signatures: string[];
} {
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (value === '') {
      continue;
    }
    if (key === 't') {
      // Digits and nothing else. `Number` alone would also read `1e9`, `0x10`
      // and `123.0` as integers.
      timestamp = /^\d{1,15}$/.test(value) ? Number(value) : null;
    } else if (key === 'v1') {
      // Only `v1` is read. Stripe adds a `v0` signature to test events, and
      // accepting any other scheme would be a downgrade.
      signatures.push(value);
    }
  }

  return { timestamp, signatures };
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload),
  );
  return [...new Uint8Array(mac)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Constant-time, so timing cannot be used to recover the signature. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<VerificationResult> {
  // An unset secret must refuse everything, and say so. WebCrypto throws on
  // a key of length zero; were it ever to accept one, the MAC for an empty
  // key is a value anyone can compute.
  if (secret === '') {
    return { ok: false, reason: 'No webhook secret configured' };
  }

  const { timestamp, signatures } = parseHeader(signatureHeader);

  if (timestamp === null || signatures.length === 0) {
    return { ok: false, reason: 'Malformed Stripe-Signature header' };
  }

  if (Math.abs(nowSeconds - timestamp) > TOLERANCE_SECONDS) {
    return { ok: false, reason: 'Signature timestamp outside tolerance' };
  }

  const expected = await hmacHex(secret, `${timestamp}.${rawBody}`);

  // While a secret is being rolled Stripe sends one `v1` signature per active
  // secret; a match on any of them passes.
  const matched = signatures.some((candidate) =>
    timingSafeEqual(candidate, expected),
  );

  return matched
    ? { ok: true, timestamp }
    : { ok: false, reason: 'Signature mismatch' };
}
