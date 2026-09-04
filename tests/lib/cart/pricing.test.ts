import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import { priceCart } from "@/lib/cart/pricing";
import { seedDatabase } from "@/scripts/seed";

const THREADED = "seed-variant-dn50-threaded";
const FLANGED = "seed-variant-dn50-flanged";

beforeEach(async () => {
  await env.DB.exec("DELETE FROM variant_prices");
  await env.DB.exec("DELETE FROM product_variants");
  await env.DB.exec("DELETE FROM product_use_cases");
  await env.DB.exec("DELETE FROM product_features");
  await env.DB.exec("DELETE FROM product_translations");
  await env.DB.exec("DELETE FROM products");
  await seedDatabase(createDb(env.DB));
});

describe("priceCart", () => {
  it("prices a valid cart from current database values", async () => {
    const result = await priceCart(
      createDb(env.DB),
      [{ variantId: THREADED, quantity: 10 }],
      "en",
      "USD",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.currency).toBe("USD");
    expect(result.lines[0].unitPriceMinor).toBe(9900);
    expect(result.lines[0].lineTotalMinor).toBe(99000);
    expect(result.subtotalMinor).toBe(99000);
  });

  it("uses the product name in the requested locale for the snapshot", async () => {
    const result = await priceCart(
      createDb(env.DB),
      [{ variantId: THREADED, quantity: 10 }],
      "de",
      "USD",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines[0].name).toBe("Edelstahl-Kugelhahn DN50");
  });

  it("sums multiple lines", async () => {
    const result = await priceCart(
      createDb(env.DB),
      [
        { variantId: THREADED, quantity: 10 },
        { variantId: FLANGED, quantity: 5 },
      ],
      "en",
      "USD",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 10 × 9900 + 5 × 16800 = 99000 + 84000
    expect(result.subtotalMinor).toBe(183_000);
  });

  it("rejects a quantity below the SKU's MOQ", async () => {
    const result = await priceCart(
      createDb(env.DB),
      [{ variantId: THREADED, quantity: 3 }], // MOQ 是 10
      "en",
      "USD",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toMatchObject({
      variantId: THREADED,
      kind: "below_moq",
      moq: 10,
    });
  });

  it("rejects a quantity above available stock", async () => {
    const result = await priceCart(
      createDb(env.DB),
      [{ variantId: THREADED, quantity: 500 }], // 库存 120
      "en",
      "USD",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toMatchObject({
      variantId: THREADED,
      kind: "insufficient_stock",
      available: 120,
    });
  });

  it("rejects a variant that no longer exists", async () => {
    const result = await priceCart(
      createDb(env.DB),
      [{ variantId: "ghost", quantity: 1 }],
      "en",
      "USD",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].kind).toBe("unavailable");
  });

  it("rejects a variant whose product is archived", async () => {
    await env.DB.exec("UPDATE products SET status = 'archived'");

    const result = await priceCart(
      createDb(env.DB),
      [{ variantId: THREADED, quantity: 10 }],
      "en",
      "USD",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].kind).toBe("unavailable");
  });

  it("rejects a SKU with no price rather than charging zero", async () => {
    await env.DB.exec(
      `DELETE FROM variant_prices WHERE variant_id = '${THREADED}'`,
    );

    const result = await priceCart(
      createDb(env.DB),
      [{ variantId: THREADED, quantity: 10 }],
      "en",
      "USD",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].kind).toBe("no_price");
  });

  it("reports every problem at once instead of one at a time", async () => {
    const result = await priceCart(
      createDb(env.DB),
      [
        { variantId: THREADED, quantity: 1 }, // 低于 MOQ
        { variantId: "ghost", quantity: 1 }, // 不存在
      ],
      "en",
      "USD",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toHaveLength(2);
  });

  it("falls back to the base currency and says so", async () => {
    const result = await priceCart(
      createDb(env.DB),
      [{ variantId: THREADED, quantity: 10 }],
      "de",
      "EUR",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 种子数据只有 USD 定价，不能按欧元收款
    expect(result.currency).toBe("USD");
  });

  it("rejects an empty cart", async () => {
    const result = await priceCart(createDb(env.DB), [], "en", "USD");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].kind).toBe("empty");
  });
});
