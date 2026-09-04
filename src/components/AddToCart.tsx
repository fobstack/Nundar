"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cartApi } from "@/api/cart-api";
import type { Locale } from "@/config/locales";
import { localePath } from "@/lib/seo";

/**
 * 加购控件。
 *
 * 数量初始值即为 MOQ、步进也按 MOQ 递增，避免用户选出 MOQ=10 时的 13 件这种
 * 无效数量。服务端仍会二次校验——前端校验只是体验，绕过它照样会被结账拦下。
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
      setError(cause instanceof Error ? cause.message : "Could not add to cart");
    }
  }

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <label className="text-sm">
          <span className="sr-only">Quantity</span>
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
          {outOfStock ? "Out of stock" : pending ? "Adding…" : "Add to cart"}
        </button>
      </div>

      {moq > 1 ? (
        <p className="mt-1 text-xs text-neutral-500">
          Minimum order quantity: {moq}
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
