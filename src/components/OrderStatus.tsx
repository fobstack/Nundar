"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Locale } from "@/config/locales";
import { localePath } from "@/lib/seo";

type Status =
  | "pending"
  | "paid"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded"
  | "oversold";

const MESSAGES: Record<Status, string> = {
  pending: "Payment is being confirmed. This usually takes a few seconds.",
  paid: "Payment received. We are preparing your order.",
  shipped: "Your order is on its way.",
  delivered: "Your order has been delivered.",
  cancelled: "This order was cancelled.",
  refunded: "This order has been refunded.",
  oversold:
    "Payment went through but the stock sold out first. We are refunding you and will be in touch.",
};

/**
 * Order status, polled while pending.
 *
 * When a buyer returns from Stripe the webhook may not have arrived yet and the
 * order is still pending. Showing "processing" and polling is the honest answer
 * there — claiming either success or failure would be a lie.
 */
export function OrderStatus({
  orderNo,
  locale,
}: {
  orderNo: string;
  locale: Locale;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    async function poll() {
      if (cancelled) return;
      attempts += 1;

      try {
        const response = await fetch(
          `/api/orders/status?orderNo=${encodeURIComponent(orderNo)}&t=${Date.now()}`,
        );

        if (response.status === 404) {
          setNotFound(true);
          return;
        }

        const data = (await response.json()) as { status: Status };
        if (cancelled) return;
        setStatus(data.status);

        // Only pending needs waiting on, and polling stops after two minutes
        // rather than running forever
        if (data.status === "pending" && attempts < 40) {
          setTimeout(poll, 3000);
        }
      } catch {
        // A network wobble should not surface as an error; the next poll retries
        if (!cancelled && attempts < 40) {
          setTimeout(poll, 3000);
        }
      }
    }

    void poll();
    return () => {
      cancelled = true;
    };
  }, [orderNo]);

  if (notFound) {
    return (
      <p className="mt-6 text-sm text-neutral-600">
        We could not find that order number.
      </p>
    );
  }

  return (
    <div className="mt-6">
      <p className="font-mono text-sm text-neutral-500">{orderNo}</p>
      <p className="mt-2">
        {status ? MESSAGES[status] : "Looking up your order…"}
      </p>

      {status === "pending" ? (
        <p className="mt-2 text-sm text-neutral-500">
          You can safely close this page — we will email you once it is
          confirmed.
        </p>
      ) : null}

      <Link
        href={localePath(locale, "products")}
        className="mt-8 inline-block underline underline-offset-4"
      >
        Continue shopping
      </Link>
    </div>
  );
}
