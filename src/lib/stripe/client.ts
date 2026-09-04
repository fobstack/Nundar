import type { Currency } from "@/config/currency";

/**
 * Stripe REST 客户端（fetch 直连，不引入 SDK）。
 *
 * 不用官方 Node SDK 的原因：在 Workers 上需要额外适配，而本项目只用到
 * 创建 PaymentIntent 与退款两个接口，直接调 REST 更少依赖也更可控——
 * 这对要开源的模板尤其重要。
 */
const API_BASE = "https://api.stripe.com/v1";

export type StripeError = { error: string };

function encodeForm(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

async function stripeRequest<T>(
  secretKey: string,
  path: string,
  body: Record<string, string>,
  idempotencyKey?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  // 幂等键让重试不会重复扣款
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  const response = await fetchImpl(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: encodeForm(body),
  });

  const payload = (await response.json()) as
    | T
    | { error?: { message?: string } };

  if (!response.ok) {
    const message =
      (payload as { error?: { message?: string } }).error?.message ??
      `Stripe request failed with status ${response.status}`;
    // 不把密钥或完整响应写进错误信息，避免泄漏进日志
    throw new Error(`Stripe: ${message}`);
  }

  return payload as T;
}

export type PaymentIntent = {
  id: string;
  client_secret: string;
  status: string;
};

/**
 * 创建 PaymentIntent。
 *
 * 金额一律取后端算好的值，绝不接受前端传入——否则用户可以用 1 分钱买走商品。
 */
export async function createPaymentIntent(
  secretKey: string,
  input: {
    amountMinor: number;
    currency: Currency;
    orderId: string;
    orderNo: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<PaymentIntent> {
  return stripeRequest<PaymentIntent>(
    secretKey,
    "/payment_intents",
    {
      amount: String(input.amountMinor),
      currency: input.currency.toLowerCase(),
      "automatic_payment_methods[enabled]": "true",
      "metadata[order_id]": input.orderId,
      "metadata[order_no]": input.orderNo,
    },
    // 同一订单重复提交只会得到同一个 PaymentIntent
    `order:${input.orderId}`,
    fetchImpl,
  );
}

export type Refund = { id: string; status: string };

export async function createRefund(
  secretKey: string,
  input: { paymentIntentId: string; reason?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<Refund> {
  const body: Record<string, string> = {
    payment_intent: input.paymentIntentId,
  };
  if (input.reason) {
    body.reason = input.reason;
  }

  return stripeRequest<Refund>(
    secretKey,
    "/refunds",
    body,
    `refund:${input.paymentIntentId}`,
    fetchImpl,
  );
}

export type CheckoutSession = {
  id: string;
  url: string;
};

/**
 * 创建 Stripe 托管结账会话。
 *
 * 相比 Elements 嵌入式支付，托管页零客户端依赖、卡号同样不经过本站服务器。
 * 代价是用户会跳到 stripe.com 完成支付，品牌一致性略差。
 *
 * 关键点：order_id 必须写进 payment_intent_data.metadata，
 * 否则 webhook 收到 payment_intent.succeeded 时找不到对应订单。
 */
export async function createCheckoutSession(
  secretKey: string,
  input: {
    amountMinor: number;
    currency: Currency;
    orderId: string;
    orderNo: string;
    productName: string;
    successUrl: string;
    cancelUrl: string;
    customerEmail?: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<CheckoutSession> {
  const body: Record<string, string> = {
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": input.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(input.amountMinor),
    "line_items[0][price_data][product_data][name]": input.productName,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    "metadata[order_id]": input.orderId,
    "metadata[order_no]": input.orderNo,
    "payment_intent_data[metadata][order_id]": input.orderId,
    "payment_intent_data[metadata][order_no]": input.orderNo,
  };

  if (input.customerEmail) {
    body.customer_email = input.customerEmail;
  }

  return stripeRequest<CheckoutSession>(
    secretKey,
    "/checkout/sessions",
    body,
    `checkout:${input.orderId}`,
    fetchImpl,
  );
}
