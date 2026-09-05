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
 * Replace the stock and price baked into a static page with live values.
 *
 * The static page gives crawlers and the first paint complete content, but the
 * stock number in it is guaranteed to go stale. One fetch after hydration
 * replaces it, so the page never promises stock that checkout then refuses.
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

    // Static pages are generated in each language's default currency, and the
    // cookie wins when the buyer has switched. Generating one static page per
    // currency is not viable, so currency can only be applied client-side.
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
        // A failed fetch keeps the static values and raises nothing: they may be
        // stale, but stale is not wrong
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
