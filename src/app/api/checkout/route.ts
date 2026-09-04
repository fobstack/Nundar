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
import { createPaymentIntent } from "@/lib/stripe/client";

const addressSchema = z.object({
  recipient: z.string().min(1).max(120),
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
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const { env } = getCloudflareContext();
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

  const intent = await createPaymentIntent(secretKey, {
    amountMinor: order.totalMinor,
    currency: priced.currency,
    orderId: order.id,
    orderNo: order.orderNo,
  });

  return Response.json({
    orderNo: order.orderNo,
    clientSecret: intent.client_secret,
    currency: priced.currency,
    totalMinor: order.totalMinor,
  });
}
