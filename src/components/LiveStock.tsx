"use client";

import { useEffect, useState } from "react";
import type { Currency } from "@/config/currency";
import type { Locale } from "@/config/locales";
import { readCurrencyCookieFromDocument } from "@/lib/currency-preference";
import { formatMoney } from "@/lib/money";

type LiveItem = {
  variantId: string;
  stock: number;
  priceMinor: number | null;
  priceCurrency: Currency | null;
};

/**
 * 用实时数据覆盖静态页里的库存与价格。
 *
 * 静态页给爬虫和首屏提供完整内容，但其中的库存必然会过期；hydration 后拉一次
 * 真实数据覆盖，避免“页面显示有货、下单才发现没货”。
 */
export function LiveStock({
  variantIds,
  currency,
  locale,
}: {
  variantIds: string[];
  currency: Currency;
  locale: Locale;
}) {
  const [items, setItems] = useState<LiveItem[] | null>(null);

  useEffect(() => {
    if (variantIds.length === 0) {
      return;
    }

    // 静态页是按语言默认币种生成的；用户切过币种时以 cookie 为准。
    // 静态页无法为每个币种各生成一份，所以币种只能在客户端覆盖。
    const preferred = readCurrencyCookieFromDocument() ?? currency;

    const controller = new AbortController();
    const params = new URLSearchParams({
      variants: variantIds.join(","),
      currency: preferred,
    });

    fetch(`/api/inventory?${params}`, { signal: controller.signal })
      .then((response) =>
        response.ok
          ? (response.json() as Promise<{ items: LiveItem[] }>)
          : null,
      )
      .then((data) => {
        if (data) {
          setItems(data.items);
        }
      })
      .catch(() => {
        // 拉取失败就保留静态页原值，不给用户报错——静态值只是可能过期，并非错误
      });

    return () => controller.abort();
  }, [variantIds, currency]);

  useEffect(() => {
    if (!items) {
      return;
    }

    for (const item of items) {
      const container = document.querySelector(
        `[data-variant-id="${item.variantId}"]`,
      );
      if (!container) {
        continue;
      }

      const stockEl = container.querySelector("[data-stock]");
      if (stockEl) {
        stockEl.textContent = String(item.stock);
      }

      const priceEl = container.querySelector("[data-price]");
      if (priceEl && item.priceMinor !== null && item.priceCurrency) {
        priceEl.textContent = formatMoney(
          item.priceMinor,
          item.priceCurrency,
          locale,
        );
      }
    }
  }, [items, locale]);

  return null;
}
