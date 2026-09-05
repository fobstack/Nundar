import { getCloudflareContext } from "@opennextjs/cloudflare";
import { DEFAULT_LOCALE, isLocale } from "@/config/locales";
import type { Currency } from "@/config/currency";
import { getDb } from "@/db/client";
import { sendTransactionalEmail, type EmailBinding } from "@/lib/email/send";
import { orderConfirmationEmail } from "@/lib/email/templates";
import { getOrder } from "@/lib/orders/admin";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { markOrderPaid } from "@/lib/orders/orders";
import { verifyStripeSignature } from "@/lib/stripe/webhook";

type StripeEvent = {
  id: string;
  type: string;
  data?: { object?: { id?: string; metadata?: { order_id?: string } } };
};

/**
 * Stripe webhook。
 *
 * 这是订单状态的唯一可信来源——用户支付后浏览器崩溃、断网都很常见，
 * 前端的"支付成功"回调不可靠。
 *
 * 处理失败必须返回非 2xx，让 Stripe 重投；重复投递由 markOrderPaid 的
 * 幂等检查兜住。
 */
export async function POST(request: Request) {
  const { env } = getCloudflareContext();
  const secret = (env as unknown as { STRIPE_WEBHOOK_SECRET?: string })
    .STRIPE_WEBHOOK_SECRET;

  // 必须读原始文本再验签：JSON 解析后再序列化会改变字节，签名就对不上了
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";

  const verification = await verifyStripeSignature(
    rawBody,
    signature,
    secret ?? "",
  );

  if (!verification.ok) {
    // 验签失败一律 400 且不重试——这不是暂时性故障，而是伪造或配置错误
    console.error(`[stripe] rejected webhook: ${verification.reason}`);
    return new Response("Invalid signature", { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return new Response("Malformed payload", { status: 400 });
  }

  if (event.type !== "payment_intent.succeeded") {
    // 其他事件当前不处理，但要回 200，否则 Stripe 会一直重投
    return new Response("Ignored", { status: 200 });
  }

  const paymentIntentId = event.data?.object?.id;
  const orderId = event.data?.object?.metadata?.order_id;

  if (!paymentIntentId || !orderId) {
    console.error("[stripe] payment_intent.succeeded without order metadata");
    return new Response("Missing order metadata", { status: 400 });
  }

  try {
    const result = await markOrderPaid(getDb(), {
      orderId,
      eventId: event.id,
      paymentIntentId,
    });

    if (result.status === "oversold") {
      // 已扣款但库存不足：进人工队列处理退款，仍回 200 避免 Stripe 重投
      console.error(`[stripe] order ${orderId} oversold, needs manual refund`);
      return Response.json({ status: result.status });
    }

    // 首次确认支付时发订单确认邮件；重复投递不再重发
    if (!result.alreadyProcessed && result.status === "paid") {
      await sendOrderConfirmation(orderId);
    }

    return Response.json({ status: result.status });
  } catch (error) {
    // 处理失败返回 5xx，Stripe 会重投；日志不带任何客户信息
    console.error(
      "[stripe] failed to process payment:",
      error instanceof Error ? error.message : String(error),
    );
    return new Response("Processing failed", { status: 500 });
  }
}

/**
 * 发订单确认邮件。
 *
 * 发信失败只记日志，不影响 webhook 的返回值——钱已经收了、库存已经扣了，
 * 因为邮件发不出去就返回 5xx 会让 Stripe 反复重投，反而更糟。
 */
async function sendOrderConfirmation(orderId: string): Promise<void> {
  const db = getDb();

  const [order] = await db
    .select({ orderNo: schema.orders.orderNo })
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .limit(1);

  if (!order) {
    return;
  }

  const detail = await getOrder(db, order.orderNo);
  const email = detail?.shippingAddress.email;

  if (!detail || !email) {
    console.error(`[stripe] order ${orderId} has no email; skipped confirmation`);
    return;
  }

  const { env } = getCloudflareContext();
  const result = await sendTransactionalEmail(
    (env as unknown as { EMAIL?: EmailBinding }).EMAIL,
    {
      to: email,
      fromAddress:
        (env as unknown as { MAIL_FROM_ADDRESS?: string }).MAIL_FROM_ADDRESS ??
        "",
      fromName: "Nundar",
      content: orderConfirmationEmail({
        orderNo: detail.orderNo,
        currency: detail.currency as Currency,
        totalMinor: detail.totalMinor,
        locale: isLocale(detail.locale) ? detail.locale : DEFAULT_LOCALE,
        lines: detail.items,
      }),
    },
  );

  if (!result.ok) {
    console.error(`[stripe] confirmation email failed: ${result.reason}`);
  }
}
