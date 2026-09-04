import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addToCart,
  CART_TTL_SECONDS,
  clearCart,
  newCartId,
  readCart,
  removeFromCart,
  setCartQuantity,
} from "@/lib/cart/cart";

const CART = "test-cart";

beforeEach(async () => {
  await clearCart(env.SESSIONS, CART);
});

describe("newCartId", () => {
  it("is unguessable and unique", () => {
    const a = newCartId();
    const b = newCartId();

    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(20);
  });
});

describe("readCart", () => {
  it("returns an empty cart for an unknown id", async () => {
    expect(await readCart(env.SESSIONS, "never-seen")).toEqual([]);
  });

  it("returns an empty cart for corrupt stored data", async () => {
    await env.SESSIONS.put("cart:broken", "not json");
    expect(await readCart(env.SESSIONS, "broken")).toEqual([]);
  });

  it("drops entries that are not well-formed rather than failing the page", async () => {
    await env.SESSIONS.put(
      "cart:messy",
      JSON.stringify([
        { variantId: "v1", quantity: 2 },
        { variantId: "", quantity: 3 },
        { variantId: "v2", quantity: 0 },
        { quantity: 5 },
      ]),
    );

    expect(await readCart(env.SESSIONS, "messy")).toEqual([
      { variantId: "v1", quantity: 2 },
    ]);
  });
});

describe("addToCart", () => {
  it("adds a line", async () => {
    await addToCart(env.SESSIONS, CART, "v1", 3);
    expect(await readCart(env.SESSIONS, CART)).toEqual([
      { variantId: "v1", quantity: 3 },
    ]);
  });

  it("accumulates quantity for a variant already in the cart", async () => {
    await addToCart(env.SESSIONS, CART, "v1", 3);
    await addToCart(env.SESSIONS, CART, "v1", 2);

    expect(await readCart(env.SESSIONS, CART)).toEqual([
      { variantId: "v1", quantity: 5 },
    ]);
  });

  it("keeps separate lines for different variants", async () => {
    await addToCart(env.SESSIONS, CART, "v1", 1);
    await addToCart(env.SESSIONS, CART, "v2", 4);

    const cart = await readCart(env.SESSIONS, CART);
    expect(cart).toHaveLength(2);
  });

  it("rejects a non-positive quantity", async () => {
    await expect(addToCart(env.SESSIONS, CART, "v1", 0)).rejects.toThrow(
      /quantity/i,
    );
    await expect(addToCart(env.SESSIONS, CART, "v1", -2)).rejects.toThrow(
      /quantity/i,
    );
  });

  it("caps a single line to a sane maximum", async () => {
    await expect(addToCart(env.SESSIONS, CART, "v1", 100_000)).rejects.toThrow(
      /quantity/i,
    );
  });
});

describe("setCartQuantity", () => {
  it("replaces rather than accumulates", async () => {
    await addToCart(env.SESSIONS, CART, "v1", 3);
    await setCartQuantity(env.SESSIONS, CART, "v1", 7);

    expect(await readCart(env.SESSIONS, CART)).toEqual([
      { variantId: "v1", quantity: 7 },
    ]);
  });

  it("removes the line when set to zero", async () => {
    await addToCart(env.SESSIONS, CART, "v1", 3);
    await setCartQuantity(env.SESSIONS, CART, "v1", 0);

    expect(await readCart(env.SESSIONS, CART)).toEqual([]);
  });
});

describe("removeFromCart", () => {
  it("removes only the named line", async () => {
    await addToCart(env.SESSIONS, CART, "v1", 1);
    await addToCart(env.SESSIONS, CART, "v2", 1);
    await removeFromCart(env.SESSIONS, CART, "v1");

    expect(await readCart(env.SESSIONS, CART)).toEqual([
      { variantId: "v2", quantity: 1 },
    ]);
  });
});

describe("cart storage policy", () => {
  it("never stores a price, so a tampered client cannot set its own", async () => {
    await addToCart(env.SESSIONS, CART, "v1", 2);
    const raw = (await env.SESSIONS.get(`cart:${CART}`)) ?? "";

    expect(raw).not.toMatch(/price/i);
    expect(raw).not.toMatch(/amount/i);
  });

  it("expires within about a month", () => {
    expect(CART_TTL_SECONDS).toBeGreaterThanOrEqual(60 * 60 * 24 * 7);
    expect(CART_TTL_SECONDS).toBeLessThanOrEqual(60 * 60 * 24 * 60);
  });
});
