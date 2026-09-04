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
 * 取指定 SKU 的实时库存与价格。
 *
 * 商品页是静态生成的，页面里的库存数字必然会过期——若直接照它下单，会出现
 * “页面显示有货、下单才发现没货”。前端 hydration 后调用本查询覆盖显示。
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
