import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cookies } from "next/headers";
import { z } from "zod";
import { CURRENCIES } from "@/config/currency";
import { LOCALES } from "@/config/locales";
import { getDb } from "@/db/client";
import { CART_COOKIE } from "@/lib/cart/cookie";
import { readCart } from "@/lib/cart/cart";
import { priceCart } from "@/lib/cart/pricing";
import { createPendingOrder } from "@/lib/orders/orders";
import { SITE } from "@/config/site";
import {
  checkRateLimit,
  clientIdentifier,
  RATE_LIMITS,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";
import { createCheckoutSession } from "@/lib/stripe/client";

const addressSchema = z.object({
  recipient: z.string().min(1).max(120),
  // 邮箱是唯一的订单通知渠道，结账时必填
  email: z.string().email().max(200),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(120),
  state: z.string().max(120).optional(),
  postalCode: z.string().min(1).max(40),
  country: z.string().length(2),
  phone: z.string().max(40).optional(),
});

const bodySchema = z.object({
  locale: z.enum(LOCALES),
  currency: z.enum(CURRENCIES),
  shippingAddress: addressSchema,
});

/**
 * 创建订单并返回 Stripe 的 client_secret。
 *
 * 金额全部由 priceCart 依据数据库当前数据重算——请求体里没有、也不接受任何金额。
 */
export async function POST(request: Request) {
  const { env } = getCloudflareContext();

  // 结账是成本最高的公开接口：每次都会建单并向 Stripe 创建会话。
  // 不限流时可被用来撑爆 D1、耗尽 Stripe 配额并产生真实账单。
  const limit = await checkRateLimit(
    env.SESSIONS,
    `checkout:${clientIdentifier(request)}`,
    RATE_LIMITS.checkout,
  );
  if (!limit.allowed) {
    return rateLimitedResponse(limit);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const secretKey = (env as unknown as { STRIPE_SECRET_KEY?: string })
    .STRIPE_SECRET_KEY;

  if (!secretKey) {
    console.error("[checkout] STRIPE_SECRET_KEY is not configured");
    return Response.json(
      { error: "Payments are not configured yet" },
      { status: 503 },
    );
  }

  const cartId = (await cookies()).get(CART_COOKIE)?.value ?? "";
  const lines = await readCart(env.SESSIONS, cartId);

  const db = getDb();
  const priced = await priceCart(
    db,
    lines,
    parsed.data.locale,
    parsed.data.currency,
  );

  if (!priced.ok) {
    // 把全部问题一次性返回，让前端能逐行提示（缺货、低于起订量等）
    return Response.json({ error: "cart_invalid", issues: priced.issues }, {
      status: 409,
    });
  }

  const order = await createPendingOrder(db, {
    cart: priced,
    locale: parsed.data.locale,
    shippingAddress: parsed.data.shippingAddress,
    customerId: null,
  });

  const session = await createCheckoutSession(secretKey, {
    amountMinor: order.totalMinor,
    currency: priced.currency,
    orderId: order.id,
    orderNo: order.orderNo,
    productName: `Order ${order.orderNo}`,
    customerEmail: parsed.data.shippingAddress.email,
    successUrl: `${SITE.url}/${parsed.data.locale}/orders/${order.orderNo}`,
    cancelUrl: `${SITE.url}/${parsed.data.locale}/cart`,
  });

  return Response.json({
    orderNo: order.orderNo,
    checkoutUrl: session.url,
    currency: priced.currency,
    totalMinor: order.totalMinor,
  });
}
