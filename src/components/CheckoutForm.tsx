"use client";

import { useEffect, useState } from "react";
import { cartApi, type CartView } from "@/api/cart-api";
import type { Currency } from "@/config/currency";
import type { Locale } from "@/config/locales";
import { formatMoney } from "@/lib/money";

const field = "mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm";

export function CheckoutForm({
  locale,
  currency,
}: {
  locale: Locale;
  currency: Currency;
}) {
  const [cart, setCart] = useState<CartView | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cartApi
      .queryCart(locale, currency)
      .then(setCart)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not load cart"),
      );
  }, [locale, currency]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const data = new FormData(event.currentTarget);

    try {
      const result = await cartApi.startCheckout(locale, currency, {
        recipient: String(data.get("recipient") ?? ""),
        line1: String(data.get("line1") ?? ""),
        line2: String(data.get("line2") ?? "") || undefined,
        city: String(data.get("city") ?? ""),
        state: String(data.get("state") ?? "") || undefined,
        postalCode: String(data.get("postalCode") ?? ""),
        country: String(data.get("country") ?? "").toUpperCase(),
        phone: String(data.get("phone") ?? "") || undefined,
      });

      // 卡号在 Stripe 托管页填写，永不经过本站
      window.location.href = result.checkoutUrl;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not start checkout",
      );
      setSubmitting(false);
    }
  }

  const total = cart
    ? formatMoney(cart.subtotalMinor, cart.currency, locale)
    : null;

  return (
    <form onSubmit={submit} className="mt-8 max-w-lg space-y-4">
      {error ? (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">
          Recipient
          <input name="recipient" required className={field} />
        </label>
        <label className="text-sm sm:col-span-2">
          Address
          <input name="line1" required className={field} />
        </label>
        <label className="text-sm sm:col-span-2">
          Address line 2
          <input name="line2" className={field} />
        </label>
        <label className="text-sm">
          City
          <input name="city" required className={field} />
        </label>
        <label className="text-sm">
          State / region
          <input name="state" className={field} />
        </label>
        <label className="text-sm">
          Postal code
          <input name="postalCode" required className={field} />
        </label>
        <label className="text-sm">
          Country code
          <input
            name="country"
            required
            maxLength={2}
            placeholder="GB"
            className={field}
          />
        </label>
        <label className="text-sm sm:col-span-2">
          Phone
          <input name="phone" className={field} />
        </label>
      </div>

      {total ? (
        <div className="flex items-center justify-between border-t border-neutral-200 pt-4">
          <span className="text-sm text-neutral-500">Total</span>
          <span className="text-lg font-semibold">{total}</span>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={submitting || !cart || cart.lines.length === 0}
        className="w-full rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-40"
      >
        {submitting ? "Redirecting to payment…" : "Continue to payment"}
      </button>

      <p className="text-xs text-neutral-500">
        Payment is handled by Stripe. Card details never reach this site.
      </p>
    </form>
  );
}
