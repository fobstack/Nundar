/**
 * Stripe webhook signature verification, on WebCrypto, without the Stripe SDK.
 *
 * Stripe's Stripe-Signature header has the form `t=<timestamp>,v1=<hex hmac>`.
 * The signed payload is `${timestamp}.${rawBody}` and the algorithm is
 * HMAC-SHA256.
 *
 * Verification is this endpoint's whole reason to exist: without it, anyone can
 * forge "payment succeeded" and take goods for free. The timestamp window is
 * what blocks replay.
 */

/** Tolerated clock skew and delivery delay */
const TOLERANCE_SECONDS = 5 * 60;

export type VerificationResult =
  | { ok: true; timestamp: number }
  | { ok: false; reason: string };

function parseHeader(header: string): {
  timestamp: number | null;
  signatures: string[];
} {
  const parts = header.split(",");
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of parts) {
    const [key, value] = part.split("=", 2);
    if (!key || !value) {
      continue;
    }
    if (key.trim() === "t") {
      const parsed = Number(value.trim());
      timestamp = Number.isInteger(parsed) ? parsed : null;
    } else if (key.trim() === "v1") {
      signatures.push(value.trim());
    }
  }

  return { timestamp, signatures };
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return [...new Uint8Array(mac)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time comparison, so timing cannot be used to recover the signature */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<VerificationResult> {
  if (!secret) {
    return { ok: false, reason: "No webhook secret configured" };
  }

  const { timestamp, signatures } = parseHeader(signatureHeader);

  if (timestamp === null || signatures.length === 0) {
    return { ok: false, reason: "Malformed Stripe-Signature header" };
  }

  if (Math.abs(nowSeconds - timestamp) > TOLERANCE_SECONDS) {
    return { ok: false, reason: "Signature timestamp outside tolerance" };
  }

  const expected = await hmacHex(secret, `${timestamp}.${rawBody}`);

  // During a secret rotation Stripe sends several v1 signatures; any match passes
  const matched = signatures.some((candidate) =>
    timingSafeEqual(candidate, expected),
  );

  return matched
    ? { ok: true, timestamp }
    : { ok: false, reason: "Signature mismatch" };
}
