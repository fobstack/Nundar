"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cartApi } from "@/api/cart-api";
import type { Locale } from "@/config/locales";
import { getStorefrontMessages } from "@/lib/storefront/i18n";
import { localePath } from "@/lib/seo";

/**
 * The add-to-cart control.
 *
 * The quantity starts at the MOQ and steps by it, so a buyer cannot land on
 * something like 13 units when the minimum is 10. The server validates again
 * regardless: this check exists for the experience, and bypassing it still
 * fails at checkout.
 */
export function AddToCart({
  variantId,
  moq,
  stock,
  locale,
}: {
  variantId: string;
  moq: number;
  stock: number;
  locale: Locale;
}) {
  const t = getStorefrontMessages(locale);
  const router = useRouter();
  const [quantity, setQuantity] = useState(moq);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const outOfStock = stock <= 0;

  async function add() {
    setError(null);
    try {
      await cartApi.addToCart(variantId, quantity);
      startTransition(() => {
        router.push(localePath(locale, "cart"));
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.addToCart.failed);
    }
  }

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <label className="text-sm">
          <span className="sr-only">{t.addToCart.quantity}</span>
          <input
            type="number"
            min={moq}
            step={moq}
            value={quantity}
            disabled={outOfStock}
            onChange={(event) =>
              setQuantity(Math.max(moq, Number(event.target.value) || moq))
            }
            className="w-24 rounded border border-neutral-300 px-2 py-1"
          />
        </label>

        <button
          type="button"
          onClick={add}
          disabled={outOfStock || pending}
          className="rounded bg-neutral-900 px-4 py-1.5 text-sm text-white disabled:opacity-40"
        >
          {outOfStock
            ? t.product.outOfStock
            : pending
              ? t.addToCart.adding
              : t.addToCart.add}
        </button>
      </div>

      {moq > 1 ? (
        <p className="mt-1 text-xs text-neutral-500">
          {t.cart.belowMoq.replace("{n}", String(moq))}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
