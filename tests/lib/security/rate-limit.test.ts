import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  checkRateLimit,
  clientIdentifier,
  RATE_LIMITS,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";

const RULE = { limit: 3, windowSeconds: 60 };

function uniqueKey(name: string): string {
  return `${name}:${crypto.randomUUID()}`;
}

describe("checkRateLimit", () => {
  it("allows requests up to the limit", async () => {
    const key = uniqueKey("allow");

    for (let attempt = 1; attempt <= RULE.limit; attempt += 1) {
      const result = await checkRateLimit(env.SESSIONS, key, RULE);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(RULE.limit - attempt);
    }
  });

  it("blocks once the limit is reached", async () => {
    const key = uniqueKey("block");

    for (let attempt = 0; attempt < RULE.limit; attempt += 1) {
      await checkRateLimit(env.SESSIONS, key, RULE);
    }

    const result = await checkRateLimit(env.SESSIONS, key, RULE);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBe(RULE.windowSeconds);
  });

  it("keeps separate buckets per key, so one client cannot block another", async () => {
    const victim = uniqueKey("victim");
    const attacker = uniqueKey("attacker");

    for (let attempt = 0; attempt < RULE.limit; attempt += 1) {
      await checkRateLimit(env.SESSIONS, attacker, RULE);
    }

    expect((await checkRateLimit(env.SESSIONS, attacker, RULE)).allowed).toBe(false);
    expect((await checkRateLimit(env.SESSIONS, victim, RULE)).allowed).toBe(true);
  });

  it("keeps separate buckets per endpoint", async () => {
    const id = crypto.randomUUID();

    for (let attempt = 0; attempt < RULE.limit; attempt += 1) {
      await checkRateLimit(env.SESSIONS, `checkout:${id}`, RULE);
    }

    expect(
      (await checkRateLimit(env.SESSIONS, `cart:${id}`, RULE)).allowed,
    ).toBe(true);
  });
});

describe("clientIdentifier", () => {
  it("uses the Cloudflare-set client IP", () => {
    const request = new Request("https://shop.example", {
      headers: { "cf-connecting-ip": "203.0.113.9" },
    });

    expect(clientIdentifier(request)).toBe("203.0.113.9");
  });

  it("ignores x-forwarded-for, which any client can forge", () => {
    const request = new Request("https://shop.example", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });

    // 用可伪造的头做限流身份，等于让攻击者自选身份绕过限流
    expect(clientIdentifier(request)).toBe("local");
  });

  it("prefers the platform header even when a forged one is present", () => {
    const request = new Request("https://shop.example", {
      headers: {
        "cf-connecting-ip": "203.0.113.9",
        "x-forwarded-for": "1.2.3.4",
      },
    });

    expect(clientIdentifier(request)).toBe("203.0.113.9");
  });
});

describe("rateLimitedResponse", () => {
  it("returns 429 with Retry-After", async () => {
    const response = rateLimitedResponse({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 600,
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("600");
    expect(await response.json()).toEqual({ error: "rate_limited" });
  });

  it("is never cached, so a 429 cannot be served to someone else", () => {
    const response = rateLimitedResponse({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 60,
    });

    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("configured limits", () => {
  it("makes checkout the tightest, since it creates orders and calls Stripe", () => {
    expect(RATE_LIMITS.checkout.limit).toBeLessThan(RATE_LIMITS.cart.limit);
  });

  it("leaves headroom for the order status page to poll", () => {
    // 成功页每 3 秒轮询一次、最多 2 分钟 → 约 40 次
    expect(RATE_LIMITS.orderStatus.limit).toBeGreaterThanOrEqual(40);
  });

  it("defines a positive window for every endpoint", () => {
    for (const rule of Object.values(RATE_LIMITS)) {
      expect(rule.limit).toBeGreaterThan(0);
      expect(rule.windowSeconds).toBeGreaterThan(0);
    }
  });
});
