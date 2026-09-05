/**
 * General-purpose rate limiter, a fixed-window counter in KV.
 *
 * Leaving public endpoints unlimited makes creating orders and enumerating
 * order numbers free: every checkout call writes an order to D1 and opens a
 * Stripe session, so without a limit it can be used to bloat the database,
 * exhaust the Stripe quota, and run up a real bill.
 *
 * Fixed window rather than sliding: KV has no atomic increment, and a sliding
 * window needs a read-modify-write across several keys — expensive at the edge
 * and still not atomic. A fixed window allows roughly a double burst at the
 * window boundary, which is fine for the actual goal of stopping automated
 * abuse.
 */
export type RateLimitRule = {
  /** Requests allowed within the window */
  limit: number;
  /** Window length, in seconds */
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  /** Requests left in this window; 0 once the limit is reached */
  remaining: number;
  /** Seconds the client should wait; 0 while under the limit */
  retryAfterSeconds: number;
};

/**
 * Derive the identity a limit is counted against.
 *
 * Cloudflare injects `cf-connecting-ip` at the edge: it is set by the platform
 * and a client cannot forge it. `x-forwarded-for` can be set to anything and
 * must never be used as a rate-limit identity — doing so would let an attacker
 * pick their own bucket.
 *
 * Local development has no such header and falls back to a shared bucket, which
 * affects only the local experience, never production correctness.
 */
export function clientIdentifier(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "local";
}

export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  rule: RateLimitRule,
): Promise<RateLimitResult> {
  const window = Math.floor(Date.now() / 1000 / rule.windowSeconds);
  const bucket = `rl:${key}:${window}`;

  const current = Number((await kv.get(bucket)) ?? 0);

  if (current >= rule.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: rule.windowSeconds,
    };
  }

  await kv.put(bucket, String(current + 1), {
    // TTL slightly outlives the window so counters expire by themselves and no
    // cleanup job is needed
    expirationTtl: rule.windowSeconds + 60,
  });

  return {
    allowed: true,
    remaining: rule.limit - current - 1,
    retryAfterSeconds: 0,
  };
}

/** The standard over-limit response. Retry-After tells a well-behaved client how long to wait. */
export function rateLimitedResponse(result: RateLimitResult): Response {
  return Response.json(
    { error: "rate_limited" },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        "Cache-Control": "no-store",
      },
    },
  );
}

/** Per-endpoint budgets, set so a real user never reaches them and a script always does. */
export const RATE_LIMITS = {
  /** Checkout creates an order and calls Stripe, so it is the most expensive */
  checkout: { limit: 10, windowSeconds: 60 * 10 },
  /** Editing a cart is normal and frequent, so the budget is generous */
  cart: { limit: 120, windowSeconds: 60 },
  /** Order status: the success page polls, but one IP should not look up many orders */
  orderStatus: { limit: 60, windowSeconds: 60 },
  /** Stock and price: one call per product page load */
  inventory: { limit: 120, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;
