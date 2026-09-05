/**
 * 通用限流器（KV 固定窗口计数）。
 *
 * 公开接口不限流，等于把创建订单、枚举单号这类操作的成本降到零：
 * 结账接口每次调用都会在 D1 建单并向 Stripe 创建会话，无限流时可被用来
 * 撑爆数据库、耗尽 Stripe 配额，甚至产生真实账单。
 *
 * 用固定窗口而非滑动窗口：KV 没有原子递增，滑动窗口需要读改写多个键，
 * 在边缘上代价高且仍非原子。固定窗口在窗口边界允许约两倍突发，
 * 对"阻止自动化滥用"这个目标足够。
 */
export type RateLimitRule = {
  /** 窗口内允许的次数 */
  limit: number;
  /** 窗口长度（秒） */
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  /** 本窗口剩余次数，已超限时为 0 */
  remaining: number;
  /** 建议客户端等待的秒数，未超限时为 0 */
  retryAfterSeconds: number;
};

/**
 * 取限流身份。
 *
 * Cloudflare 在边缘注入 `cf-connecting-ip`，它由平台设置、客户端无法伪造；
 * `x-forwarded-for` 可被任意伪造，绝不能用作限流身份。
 * 本地开发没有该头，退化为共享桶——只影响本地体验，不影响线上正确性。
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
    // TTL 略长于窗口，确保计数在窗口结束后自动消失，无需清理任务
    expirationTtl: rule.windowSeconds + 60,
  });

  return {
    allowed: true,
    remaining: rule.limit - current - 1,
    retryAfterSeconds: 0,
  };
}

/** 超限时的标准响应。带 Retry-After，让守规矩的客户端知道该等多久。 */
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

/** 各接口的限流额度。数值按"正常用户绝不会触碰、自动化滥用必然触碰"来定。 */
export const RATE_LIMITS = {
  /** 结账会建单并调 Stripe，成本最高 */
  checkout: { limit: 10, windowSeconds: 60 * 10 },
  /** 改购物车是高频正常操作，额度放宽 */
  cart: { limit: 120, windowSeconds: 60 },
  /** 查订单状态：成功页会轮询，但单个 IP 不该查很多单号 */
  orderStatus: { limit: 60, windowSeconds: 60 },
  /** 查库存价格：商品页每次加载一次 */
  inventory: { limit: 120, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;
