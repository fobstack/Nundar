import type { Currency } from "@/config/currency";
import type { Locale } from "@/config/locales";

export type CartLineView = {
  variantId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
};

export type CartIssueView = {
  kind: "empty" | "unavailable" | "no_price" | "below_moq" | "insufficient_stock";
  variantId?: string;
  moq?: number;
  available?: number;
  requested?: number;
};

export type CartView = {
  lines: CartLineView[];
  subtotalMinor: number;
  currency: Currency;
  issues: CartIssueView[];
};

export type CheckoutAddress = {
  recipient: string;
  email: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
  phone?: string;
};

async function parse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed (${response.status})`);
  }
  return payload;
}

export const cartApi = {
  /** Read the cart and price it against current data */
  queryCart: async (locale: Locale, currency: Currency): Promise<CartView> => {
    // A cache-buster on the GET, so neither the browser nor an intermediary
    // hands back a stale cart
    const params = new URLSearchParams({
      locale,
      currency,
      t: String(Date.now()),
    });
    return parse<CartView>(await fetch(`/api/cart?${params}`));
  },

  /** Add a line to the cart */
  addToCart: async (variantId: string, quantity: number) =>
    parse<{ lines: { variantId: string; quantity: number }[] }>(
      await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", variantId, quantity }),
      }),
    ),

  /** Set a line's quantity; 0 removes it */
  setQuantity: async (variantId: string, quantity: number) =>
    parse<{ lines: { variantId: string; quantity: number }[] }>(
      await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set", variantId, quantity }),
      }),
    ),

  /** Remove a line */
  removeLine: async (variantId: string) =>
    parse<{ lines: { variantId: string; quantity: number }[] }>(
      await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", variantId }),
      }),
    ),

  /** Create the order and get back the Stripe hosted checkout URL */
  startCheckout: async (
    locale: Locale,
    currency: Currency,
    shippingAddress: CheckoutAddress,
  ) =>
    parse<{
      orderNo: string;
      checkoutUrl: string;
      currency: Currency;
      totalMinor: number;
    }>(
      await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale, currency, shippingAddress }),
      }),
    ),
};
