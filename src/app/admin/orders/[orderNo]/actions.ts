"use server";

import { revalidatePath } from "next/cache";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import { getDb } from "@/db/client";
import { isLocale, DEFAULT_LOCALE } from "@/config/locales";
import { requireAdmin } from "@/lib/auth/guard";
import { sendTransactionalEmail, type EmailBinding } from "@/lib/email/send";
import { shippingNotificationEmail } from "@/lib/email/templates";
import {
  cancelOrder,
  getOrder,
  markDelivered,
  refundOrder,
  shipOrder,
} from "@/lib/orders/admin";
import { createRefund } from "@/lib/stripe/client";

const shipSchema = z.object({
  orderId: z.string().min(1),
  orderNo: z.string().min(1),
  trackingNo: z.string().min(1, "Tracking number is required"),
});

const orderRefSchema = z.object({
  orderId: z.string().min(1),
  orderNo: z.string().min(1),
});

export async function shipOrderAction(formData: FormData) {
  await requireAdmin();

  const input = shipSchema.parse({
    orderId: formData.get("orderId"),
    orderNo: formData.get("orderNo"),
    trackingNo: formData.get("trackingNo"),
  });

  const db = getDb();
  await shipOrder(db, input.orderId, input.trackingNo);

  // 发货通知发不出去不该让发货本身失败——货已经寄了
  const order = await getOrder(db, input.orderNo);
  const email = order?.shippingAddress.email;

  if (email) {
    const { env } = getCloudflareContext();
    const result = await sendTransactionalEmail(
      (env as unknown as { EMAIL?: EmailBinding }).EMAIL,
      {
        to: email,
        fromAddress:
          (env as unknown as { MAIL_FROM_ADDRESS?: string })
            .MAIL_FROM_ADDRESS ?? "",
        fromName: "Kontor",
        content: shippingNotificationEmail({
          orderNo: input.orderNo,
          locale: isLocale(order.locale) ? order.locale : DEFAULT_LOCALE,
          trackingNo: input.trackingNo,
        }),
      },
    );

    if (!result.ok) {
      console.error(`[orders] shipping email failed: ${result.reason}`);
    }
  }

  revalidatePath(`/admin/orders/${input.orderNo}`);
  revalidatePath("/admin/orders");
}

export async function deliverOrderAction(formData: FormData) {
  await requireAdmin();
  const input = orderRefSchema.parse({
    orderId: formData.get("orderId"),
    orderNo: formData.get("orderNo"),
  });

  await markDelivered(getDb(), input.orderId);
  revalidatePath(`/admin/orders/${input.orderNo}`);
  revalidatePath("/admin/orders");
}

export async function cancelOrderAction(formData: FormData) {
  await requireAdmin();
  const input = orderRefSchema.parse({
    orderId: formData.get("orderId"),
    orderNo: formData.get("orderNo"),
  });

  await cancelOrder(getDb(), input.orderId);
  revalidatePath(`/admin/orders/${input.orderNo}`);
  revalidatePath("/admin/orders");
}

export async function refundOrderAction(formData: FormData) {
  await requireAdmin();
  const input = orderRefSchema.parse({
    orderId: formData.get("orderId"),
    orderNo: formData.get("orderNo"),
  });

  const db = getDb();
  const order = await getOrder(db, input.orderNo);

  // 先向 Stripe 退款；退款失败就不改本地状态，避免账实不符
  if (order?.stripePaymentIntentId) {
    const { env } = getCloudflareContext();
    const secretKey = (env as unknown as { STRIPE_SECRET_KEY?: string })
      .STRIPE_SECRET_KEY;

    if (!secretKey) {
      throw new Error("STRIPE_SECRET_KEY is not configured; cannot refund");
    }

    await createRefund(secretKey, {
      paymentIntentId: order.stripePaymentIntentId,
    });
  }

  await refundOrder(db, input.orderId);
  revalidatePath(`/admin/orders/${input.orderNo}`);
  revalidatePath("/admin/orders");
}
