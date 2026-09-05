import { and, inArray } from "drizzle-orm";
import { BASE_CURRENCY, type Currency } from "@/config/currency";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";

export type LiveInventoryItem = {
  variantId: string;
  stock: number;
  priceMinor: number | null;
  priceCurrency: Currency | null;
};

/**
 * Live stock and price for a set of SKUs.
 *
 * Product pages are statically generated, so the stock number baked into the
 * HTML is guaranteed to go stale. Ordering against it produces the worst
 * version of that: the page said in stock, and checkout says otherwise. The
 * client calls this after hydration and patches the displayed values.
 */
export async function getLiveInventory(
  db: Db,
  variantIds: string[],
  currency: Currency = BASE_CURRENCY,
): Promise<LiveInventoryItem[]> {
  if (variantIds.length === 0) {
    return [];
  }

  const currencies =
    currency === BASE_CURRENCY ? [BASE_CURRENCY] : [currency, BASE_CURRENCY];

  const [variants, prices] = await Promise.all([
    db
      .select({
        id: schema.productVariants.id,
        stock: schema.productVariants.stock,
      })
      .from(schema.productVariants)
      .where(inArray(schema.productVariants.id, variantIds)),
    db
      .select({
        variantId: schema.variantPrices.variantId,
        currency: schema.variantPrices.currency,
        amountMinor: schema.variantPrices.amountMinor,
      })
      .from(schema.variantPrices)
      .where(
        and(
          inArray(schema.variantPrices.variantId, variantIds),
          inArray(schema.variantPrices.currency, currencies),
        ),
      ),
  ]);

  return variants.map((variant) => {
    const own = prices.filter((price) => price.variantId === variant.id);
    const exact = own.find((price) => price.currency === currency);
    const base = own.find((price) => price.currency === BASE_CURRENCY);
    const chosen = exact ?? base;

    return {
      variantId: variant.id,
      stock: variant.stock,
      priceMinor: chosen?.amountMinor ?? null,
      priceCurrency: chosen
        ? (chosen.currency as Currency)
        : null,
    };
  });
}
