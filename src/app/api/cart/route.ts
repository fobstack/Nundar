import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cookies } from "next/headers";
import { z } from "zod";
import { CURRENCIES, BASE_CURRENCY } from "@/config/currency";
import { DEFAULT_LOCALE, LOCALES } from "@/config/locales";
import { getDb } from "@/db/client";
import {
  addToCart,
  newCartId,
  readCart,
  removeFromCart,
  setCartQuantity,
} from "@/lib/cart/cart";
import { CART_COOKIE, CART_COOKIE_MAX_AGE } from "@/lib/cart/cookie";
import { priceCart } from "@/lib/cart/pricing";
import {
  checkRateLimit,
  clientIdentifier,
  RATE_LIMITS,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";

const mutationSchema = z.object({
  action: z.enum(["add", "set", "remove"]),
  variantId: z.string().min(1),
  quantity: z.number().int().min(0).max(10_000).optional(),
});

async function cartIdFromCookies(): Promise<string> {
  return (await cookies()).get(CART_COOKIE)?.value ?? "";
}

/** 读购物车并按当前数据定价 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const locale = LOCALES.includes(
    (url.searchParams.get("locale") ?? "") as (typeof LOCALES)[number],
  )
    ? (url.searchParams.get("locale") as (typeof LOCALES)[number])
    : DEFAULT_LOCALE;
  const currency = CURRENCIES.includes(
    (url.searchParams.get("currency") ?? "") as (typeof CURRENCIES)[number],
  )
    ? (url.searchParams.get("currency") as (typeof CURRENCIES)[number])
    : BASE_CURRENCY;

  const { env } = getCloudflareContext();
  const lines = await readCart(env.SESSIONS, await cartIdFromCookies());

  if (lines.length === 0) {
    return Response.json(
      { lines: [], subtotalMinor: 0, currency, issues: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const priced = await priceCart(getDb(), lines, locale, currency);

  return Response.json(
    priced.ok
      ? {
          lines: priced.lines,
          subtotalMinor: priced.subtotalMinor,
          currency: priced.currency,
          issues: [],
        }
      : { lines: [], subtotalMinor: 0, currency, issues: priced.issues },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** 改购物车。只接受 variantId 与数量，价格永远由服务端算 */
export async function POST(request: Request) {
  const { env } = getCloudflareContext();

  const limit = await checkRateLimit(
    env.SESSIONS,
    `cart:${clientIdentifier(request)}`,
    RATE_LIMITS.cart,
  );
  if (!limit.allowed) {
    return rateLimitedResponse(limit);
  }

  const parsed = mutationSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const store = await cookies();
  let cartId = store.get(CART_COOKIE)?.value ?? "";

  if (!cartId) {
    cartId = newCartId();
    store.set({
      name: CART_COOKIE,
      value: cartId,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: CART_COOKIE_MAX_AGE,
    });
  }

  const { action, variantId, quantity } = parsed.data;

  try {
    if (action === "remove") {
      await removeFromCart(env.SESSIONS, cartId, variantId);
    } else if (action === "set") {
      await setCartQuantity(env.SESSIONS, cartId, variantId, quantity ?? 0);
    } else {
      await addToCart(env.SESSIONS, cartId, variantId, quantity ?? 1);
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Cart update failed" },
      { status: 400 },
    );
  }

  const lines = await readCart(env.SESSIONS, cartId);
  return Response.json(
    { lines },
    { headers: { "Cache-Control": "no-store" } },
  );
}
