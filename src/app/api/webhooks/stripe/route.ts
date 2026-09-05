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
 * The Stripe webhook.
 *
 * This is the only trustworthy source of order status. Browsers crash and
 * connections drop right after payment all the time, so a client-side "payment
 * succeeded" callback cannot be relied on.
 *
 * A failure here must return a non-2xx so Stripe redelivers; the redelivery is
 * absorbed by markOrderPaid's idempotency check.
 */
export async function POST(request: Request) {
  const { env } = getCloudflareContext();
  const secret = (env as unknown as { STRIPE_WEBHOOK_SECRET?: string })
    .STRIPE_WEBHOOK_SECRET;

  // Read the raw text before verifying: parsing and re-serialising the JSON
  // changes the bytes and the signature no longer matches
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";

  const verification = await verifyStripeSignature(
    rawBody,
    signature,
    secret ?? "",
  );

  if (!verification.ok) {
    // A failed signature is a 400 with no retry: this is not a transient fault but
    // either a forgery or a misconfiguration
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
    // Other events are not handled but must still return 200, or Stripe redelivers
    // them forever
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
      // Paid but the stock was gone: queue it for a manual refund and still return
      // 200, so Stripe stops redelivering
      console.error(`[stripe] order ${orderId} oversold, needs manual refund`);
      return Response.json({ status: result.status });
    }

    // Send the confirmation email on the first confirmation only; redeliveries do
    // not send it again
    if (!result.alreadyProcessed && result.status === "paid") {
      await sendOrderConfirmation(orderId);
    }

    return Response.json({ status: result.status });
  } catch (error) {
    // A failure returns 5xx and Stripe redelivers; the log carries no customer data
    console.error(
      "[stripe] failed to process payment:",
      error instanceof Error ? error.message : String(error),
    );
    return new Response("Processing failed", { status: 500 });
  }
}

/**
 * Send the order confirmation email.
 *
 * A send failure is logged and nothing more; it never changes what the webhook
 * returns. The money is taken and the stock is decremented, so returning 5xx
 * over an undeliverable email would only make Stripe redeliver an event that
 * was already handled correctly.
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
