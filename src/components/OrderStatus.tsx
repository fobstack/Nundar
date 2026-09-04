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
 * 订单状态显示，pending 时轮询。
 *
 * 用户从 Stripe 跳回来时 webhook 可能还没到，订单还是 pending——
 * 此时显示"处理中"并轮询，而不是谎报成功或谎报失败。
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

        // 只有 pending 需要继续等；最多轮询 2 分钟后停下，避免无限请求
        if (data.status === "pending" && attempts < 40) {
          setTimeout(poll, 3000);
        }
      } catch {
        // 网络抖动不该让页面报错，下一轮重试即可
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
