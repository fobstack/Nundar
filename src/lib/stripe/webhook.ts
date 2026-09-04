/**
 * Stripe webhook 签名校验（WebCrypto 实现，不依赖 Stripe SDK）。
 *
 * Stripe 的 Stripe-Signature 头形如 `t=<timestamp>,v1=<hex hmac>`，签名对象是
 * `${timestamp}.${rawBody}`，算法 HMAC-SHA256。
 *
 * 校验签名是这个端点的生命线：不校验就等于任何人都能伪造"支付成功"，
 * 白拿货。时间戳窗口则用来阻断重放。
 */

/** 容忍的时钟偏差与投递延迟 */
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

/** 定长比较，避免用比较耗时反推正确签名 */
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

  // 轮换密钥期间 Stripe 会带多个 v1，任一匹配即通过
  const matched = signatures.some((candidate) =>
    timingSafeEqual(candidate, expected),
  );

  return matched
    ? { ok: true, timestamp }
    : { ok: false, reason: "Signature mismatch" };
}
