import { describe, expect, it } from "vitest";
import {
  createCheckoutSession,
  createPaymentIntent,
  createRefund,
} from "@/lib/stripe/client";

type Captured = { url: string; init: RequestInit };

function recordingFetch(response: unknown, status = 200) {
  const calls: Captured[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(response), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return { impl, calls };
}

function bodyOf(call: Captured): URLSearchParams {
  return new URLSearchParams(String(call.init.body));
}

describe("createPaymentIntent", () => {
  it("sends the amount in minor units and lowercase currency", async () => {
    const { impl, calls } = recordingFetch({
      id: "pi_1",
      client_secret: "cs_1",
      status: "requires_payment_method",
    });

    await createPaymentIntent(
      "sk_test_123",
      {
        amountMinor: 99_000,
        currency: "EUR",
        orderId: "order-1",
        orderNo: "KT-260904-ABC123",
      },
      impl,
    );

    const body = bodyOf(calls[0]);
    expect(calls[0].url).toBe("https://api.stripe.com/v1/payment_intents");
    expect(body.get("amount")).toBe("99000");
    expect(body.get("currency")).toBe("eur");
  });

  it("attaches the order id so the webhook can find the order", async () => {
    const { impl, calls } = recordingFetch({
      id: "pi_1",
      client_secret: "cs_1",
      status: "requires_payment_method",
    });

    await createPaymentIntent(
      "sk_test_123",
      {
        amountMinor: 100,
        currency: "USD",
        orderId: "order-42",
        orderNo: "KT-260904-XYZ789",
      },
      impl,
    );

    const body = bodyOf(calls[0]);
    expect(body.get("metadata[order_id]")).toBe("order-42");
    expect(body.get("metadata[order_no]")).toBe("KT-260904-XYZ789");
  });

  it("sends an idempotency key keyed on the order, so retries do not double-charge", async () => {
    const { impl, calls } = recordingFetch({
      id: "pi_1",
      client_secret: "cs_1",
      status: "requires_payment_method",
    });

    await createPaymentIntent(
      "sk_test_123",
      {
        amountMinor: 100,
        currency: "USD",
        orderId: "order-7",
        orderNo: "KT-1",
      },
      impl,
    );

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("order:order-7");
    expect(headers.Authorization).toBe("Bearer sk_test_123");
  });

  it("surfaces Stripe's error message without leaking the whole response", async () => {
    const { impl } = recordingFetch(
      { error: { message: "Amount must be at least 50 cents" } },
      400,
    );

    await expect(
      createPaymentIntent(
        "sk_test_123",
        { amountMinor: 1, currency: "USD", orderId: "o", orderNo: "n" },
        impl,
      ),
    ).rejects.toThrow(/at least 50 cents/);
  });

  it("still throws a useful error when Stripe returns no message", async () => {
    const { impl } = recordingFetch({}, 500);

    await expect(
      createPaymentIntent(
        "sk_test_123",
        { amountMinor: 100, currency: "USD", orderId: "o", orderNo: "n" },
        impl,
      ),
    ).rejects.toThrow(/500/);
  });
});

describe("createRefund", () => {
  it("refunds against the payment intent", async () => {
    const { impl, calls } = recordingFetch({ id: "re_1", status: "succeeded" });

    await createRefund("sk_test_123", { paymentIntentId: "pi_9" }, impl);

    expect(calls[0].url).toBe("https://api.stripe.com/v1/refunds");
    expect(bodyOf(calls[0]).get("payment_intent")).toBe("pi_9");
  });

  it("keys idempotency on the payment intent", async () => {
    const { impl, calls } = recordingFetch({ id: "re_1", status: "succeeded" });

    await createRefund("sk_test_123", { paymentIntentId: "pi_9" }, impl);

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("refund:pi_9");
  });
});

describe("createCheckoutSession", () => {
  it("charges the server-computed total as a single line item", async () => {
    const { impl, calls } = recordingFetch({
      id: "cs_1",
      url: "https://checkout.stripe.com/c/pay/cs_1",
    });

    await createCheckoutSession(
      "sk_test_123",
      {
        amountMinor: 99_000,
        currency: "USD",
        orderId: "order-1",
        orderNo: "KT-1",
        productName: "Order KT-1",
        successUrl: "https://shop.example/en/orders/KT-1",
        cancelUrl: "https://shop.example/en/cart",
      },
      impl,
    );

    const body = bodyOf(calls[0]);
    expect(calls[0].url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("99000");
    expect(body.get("line_items[0][quantity]")).toBe("1");
    expect(body.get("mode")).toBe("payment");
  });

  it("propagates the order id onto the payment intent, which the webhook reads", async () => {
    const { impl, calls } = recordingFetch({ id: "cs_1", url: "https://x" });

    await createCheckoutSession(
      "sk_test_123",
      {
        amountMinor: 100,
        currency: "USD",
        orderId: "order-99",
        orderNo: "KT-9",
        productName: "Order KT-9",
        successUrl: "https://shop.example/ok",
        cancelUrl: "https://shop.example/cart",
      },
      impl,
    );

    const body = bodyOf(calls[0]);
    // webhook 收到的是 payment_intent.succeeded，只有这里带上 order_id 才找得到订单
    expect(body.get("payment_intent_data[metadata][order_id]")).toBe("order-99");
    expect(body.get("metadata[order_id]")).toBe("order-99");
  });

  it("keys idempotency on the order so a double submit reuses the session", async () => {
    const { impl, calls } = recordingFetch({ id: "cs_1", url: "https://x" });

    await createCheckoutSession(
      "sk_test_123",
      {
        amountMinor: 100,
        currency: "USD",
        orderId: "order-3",
        orderNo: "KT-3",
        productName: "Order KT-3",
        successUrl: "https://shop.example/ok",
        cancelUrl: "https://shop.example/cart",
      },
      impl,
    );

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("checkout:order-3");
  });
});
