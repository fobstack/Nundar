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
  /** 读购物车并按当前数据定价 */
  queryCart: async (locale: Locale, currency: Currency): Promise<CartView> => {
    // GET 加缓存戳，避免浏览器或中间代理返回过期的购物车
    const params = new URLSearchParams({
      locale,
      currency,
      t: String(Date.now()),
    });
    return parse<CartView>(await fetch(`/api/cart?${params}`));
  },

  /** 加入购物车 */
  addToCart: async (variantId: string, quantity: number) =>
    parse<{ lines: { variantId: string; quantity: number }[] }>(
      await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", variantId, quantity }),
      }),
    ),

  /** 设置某行数量，0 表示删除 */
  setQuantity: async (variantId: string, quantity: number) =>
    parse<{ lines: { variantId: string; quantity: number }[] }>(
      await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set", variantId, quantity }),
      }),
    ),

  /** 移除某行 */
  removeLine: async (variantId: string) =>
    parse<{ lines: { variantId: string; quantity: number }[] }>(
      await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", variantId }),
      }),
    ),

  /** 创建订单并取得 Stripe 托管结账地址 */
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
