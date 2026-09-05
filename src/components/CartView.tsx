"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { cartApi, type CartIssueView, type CartView } from "@/api/cart-api";
import type { Currency } from "@/config/currency";
import type { Locale } from "@/config/locales";
import { formatMoney } from "@/lib/money";
import { localePath } from "@/lib/seo";
import {
  getStorefrontMessages,
  type StorefrontMessages,
} from "@/lib/storefront/i18n";

function issueText(issue: CartIssueView, t: StorefrontMessages): string {
  switch (issue.kind) {
    case "below_moq":
      return t.cart.belowMoq.replace("{n}", String(issue.moq));
    case "insufficient_stock":
      return t.cart.insufficientStock.replace("{n}", String(issue.available));
    case "unavailable":
      return t.cart.unavailable;
    case "no_price":
      return t.cart.noPrice;
    default:
      return t.cart.empty;
  }
}

export function CartPageView({
  locale,
  currency,
}: {
  locale: Locale;
  currency: Currency;
}) {
  const t = getStorefrontMessages(locale);
  const [cart, setCart] = useState<CartView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setCart(await cartApi.queryCart(locale, currency));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.cart.loadFailed);
    }
  }, [locale, currency, t.cart.loadFailed]);

  useEffect(() => {
    let cancelled = false;

    // Calling setState synchronously inside an effect cascades renders; fetch
    // first and set state only if the component is still mounted
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
            cause instanceof Error ? cause.message : t.cart.loadFailed,
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [locale, currency, t.cart.loadFailed]);

  async function update(variantId: string, quantity: number) {
    setBusy(true);
    setError(null);
    try {
      await cartApi.setQuantity(variantId, quantity);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.cart.updateFailed);
    } finally {
      setBusy(false);
    }
  }

  if (!cart) {
    return <p className="mt-8 text-sm text-neutral-500">{t.cart.loading}</p>;
  }

  const empty = cart.lines.length === 0;

  return (
    <div className="mt-8">
      {error ? (
        <p role="alert" className="mb-4 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {/* Every problem listed line by line, so the buyer knows which one to fix */}
      {cart.issues.length > 0 ? (
        <ul className="mb-6 space-y-1 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {cart.issues.map((issue, index) => (
            <li key={`${issue.kind}-${issue.variantId ?? index}`}>
              {issueText(issue, t)}
            </li>
          ))}
        </ul>
      ) : null}

      {empty ? (
        <p className="text-sm text-neutral-500">
          {t.cart.empty}{" "}
          <Link
            href={localePath(locale, "products")}
            className="underline underline-offset-4"
          >
            {t.cart.browseProducts}
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
                    {t.cart.remove}
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex items-center justify-between">
            <span className="text-sm text-neutral-500">{t.cart.subtotal}</span>
            <span className="text-lg font-semibold">
              {formatMoney(cart.subtotalMinor, cart.currency, locale)}
            </span>
          </div>

          <Link
            href={localePath(locale, "checkout")}
            className="mt-6 inline-block rounded bg-neutral-900 px-5 py-2 text-white"
          >
            {t.nav.checkout}
          </Link>
        </>
      )}
    </div>
  );
}
