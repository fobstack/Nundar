"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { cartApi, type CartIssueView, type CartView } from "@/api/cart-api";
import type { Currency } from "@/config/currency";
import type { Locale } from "@/config/locales";
import { formatMoney } from "@/lib/money";
import { localePath } from "@/lib/seo";

function issueText(issue: CartIssueView): string {
  switch (issue.kind) {
    case "below_moq":
      return `Minimum order quantity is ${issue.moq}.`;
    case "insufficient_stock":
      return `Only ${issue.available} left in stock.`;
    case "unavailable":
      return "This item is no longer available.";
    case "no_price":
      return "This item has no price for your currency yet.";
    default:
      return "Your cart is empty.";
  }
}

export function CartPageView({
  locale,
  currency,
}: {
  locale: Locale;
  currency: Currency;
}) {
  const [cart, setCart] = useState<CartView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setCart(await cartApi.queryCart(locale, currency));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load cart");
    }
  }, [locale, currency]);

  useEffect(() => {
    let cancelled = false;

    // 在 effect 里同步 setState 会触发级联渲染；先取数据、组件仍挂载时再设值
    cartApi
      .queryCart(locale, currency)
      .then((next) => {
        if (!cancelled) {
          setCart(next);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "Could not load cart",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [locale, currency]);

  async function update(variantId: string, quantity: number) {
    setBusy(true);
    setError(null);
    try {
      await cartApi.setQuantity(variantId, quantity);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update cart");
    } finally {
      setBusy(false);
    }
  }

  if (!cart) {
    return <p className="mt-8 text-sm text-neutral-500">Loading…</p>;
  }

  const empty = cart.lines.length === 0;

  return (
    <div className="mt-8">
      {error ? (
        <p role="alert" className="mb-4 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {/* 购物车里的问题逐条列出，用户才知道该改哪一行 */}
      {cart.issues.length > 0 ? (
        <ul className="mb-6 space-y-1 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {cart.issues.map((issue, index) => (
            <li key={`${issue.kind}-${issue.variantId ?? index}`}>
              {issueText(issue)}
            </li>
          ))}
        </ul>
      ) : null}

      {empty ? (
        <p className="text-sm text-neutral-500">
          Your cart is empty.{" "}
          <Link
            href={localePath(locale, "products")}
            className="underline underline-offset-4"
          >
            Browse products
          </Link>
        </p>
      ) : (
        <>
          <ul className="space-y-4">
            {cart.lines.map((line) => (
              <li
                key={line.variantId}
                className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 pb-4"
              >
                <div className="min-w-0">
                  <p className="font-medium">{line.name}</p>
                  <p className="font-mono text-xs text-neutral-500">{line.sku}</p>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={0}
                    value={line.quantity}
                    disabled={busy}
                    onChange={(event) =>
                      void update(line.variantId, Number(event.target.value) || 0)
                    }
                    className="w-20 rounded border border-neutral-300 px-2 py-1"
                  />
                  <span className="w-24 text-right">
                    {formatMoney(line.lineTotalMinor, cart.currency, locale)}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void update(line.variantId, 0)}
                    className="text-sm text-neutral-500 underline underline-offset-4"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex items-center justify-between">
            <span className="text-sm text-neutral-500">Subtotal</span>
            <span className="text-lg font-semibold">
              {formatMoney(cart.subtotalMinor, cart.currency, locale)}
            </span>
          </div>

          <Link
            href={localePath(locale, "checkout")}
            className="mt-6 inline-block rounded bg-neutral-900 px-5 py-2 text-white"
          >
            Checkout
          </Link>
        </>
      )}
    </div>
  );
}
