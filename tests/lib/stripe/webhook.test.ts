import { describe, expect, it } from "vitest";
import { verifyStripeSignature } from "@/lib/stripe/webhook";

const SECRET = "whsec_test_secret";
const PAYLOAD = '{"id":"evt_1","type":"payment_intent.succeeded"}';

async function sign(payload: string, timestamp: number, secret = SECRET) {
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
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  return [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function header(payload: string, offsetSeconds = 0, secret = SECRET) {
  const timestamp = Math.floor(Date.now() / 1000) + offsetSeconds;
  return `t=${timestamp},v1=${await sign(payload, timestamp, secret)}`;
}

describe("verifyStripeSignature", () => {
  it("accepts a correctly signed payload", async () => {
    const result = await verifyStripeSignature(
      PAYLOAD,
      await header(PAYLOAD),
      SECRET,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a payload that was altered after signing", async () => {
    const signature = await header(PAYLOAD);
    const result = await verifyStripeSignature(
      PAYLOAD.replace("evt_1", "evt_2"),
      signature,
      SECRET,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/signature/i);
  });

  it("rejects a signature made with a different secret", async () => {
    const result = await verifyStripeSignature(
      PAYLOAD,
      await header(PAYLOAD, 0, "whsec_wrong"),
      SECRET,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a stale timestamp, so captured requests cannot be replayed", async () => {
    const result = await verifyStripeSignature(
      PAYLOAD,
      await header(PAYLOAD, -60 * 60),
      SECRET,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/timestamp/i);
  });

  it("rejects a timestamp far in the future", async () => {
    const result = await verifyStripeSignature(
      PAYLOAD,
      await header(PAYLOAD, 60 * 60),
      SECRET,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed header", async () => {
    for (const bad of ["", "garbage", "t=abc,v1=def", "v1=onlysignature"]) {
      const result = await verifyStripeSignature(PAYLOAD, bad, SECRET);
      expect(result.ok).toBe(false);
    }
  });

  it("accepts a header carrying several v1 signatures during secret rotation", async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const good = await sign(PAYLOAD, timestamp);
    const other = await sign(PAYLOAD, timestamp, "whsec_other");

    const result = await verifyStripeSignature(
      PAYLOAD,
      `t=${timestamp},v1=${other},v1=${good}`,
      SECRET,
    );
    expect(result.ok).toBe(true);
  });

  it("refuses to verify when no secret is configured", async () => {
    const result = await verifyStripeSignature(
      PAYLOAD,
      await header(PAYLOAD),
      "",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/secret/i);
  });
});
