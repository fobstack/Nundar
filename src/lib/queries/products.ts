import { and, asc, eq, inArray } from "drizzle-orm";
import { BASE_CURRENCY, type Currency } from "@/config/currency";
import type { Locale } from "@/config/locales";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";

export type ProductListItem = {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  /** 该商品各 SKU 中的最低价，无任何定价时为 null */
  fromPriceMinor: number | null;
  /**
   * fromPriceMinor 实际所属的币种。
   * 请求币种缺少定价时会回落到基准币种，此处如实报告回落后的币种，
   * 避免把美元金额挂上欧元符号展示。
   */
  priceCurrency: Currency | null;
};

/** 列出在售商品及其指定语言的名称与最低价 */
export async function listActiveProducts(
  db: Db,
  locale: Locale,
  currency: Currency = BASE_CURRENCY,
): Promise<ProductListItem[]> {
  // 同时取请求币种与基准币种的价格行，回落逻辑在内存里判定，避免两次查库
  const currencies =
    currency === BASE_CURRENCY ? [BASE_CURRENCY] : [currency, BASE_CURRENCY];

  const rows = await db
    .select({
      id: schema.products.id,
      slug: schema.products.slug,
      name: schema.productTranslations.name,
      summary: schema.productTranslations.summary,
      amountMinor: schema.variantPrices.amountMinor,
      currency: schema.variantPrices.currency,
    })
    .from(schema.products)
    .innerJoin(
      schema.productTranslations,
      and(
        eq(schema.productTranslations.productId, schema.products.id),
        eq(schema.productTranslations.locale, locale),
      ),
    )
    .leftJoin(
      schema.productVariants,
      eq(schema.productVariants.productId, schema.products.id),
    )
    .leftJoin(
      schema.variantPrices,
      and(
        eq(schema.variantPrices.variantId, schema.productVariants.id),
        inArray(schema.variantPrices.currency, currencies),
      ),
    )
    .where(eq(schema.products.status, "active"))
    .orderBy(asc(schema.products.slug));

  type Accumulator = ProductListItem & {
    requestedMinor: number | null;
    baseMinor: number | null;
  };

  // 一个商品有多个 SKU、多个币种，会产生多行，收敛为每商品一行
  const byProduct = new Map<string, Accumulator>();

  for (const row of rows) {
    let item = byProduct.get(row.id);
    if (!item) {
      item = {
        id: row.id,
        slug: row.slug,
        name: row.name,
        summary: row.summary,
        fromPriceMinor: null,
        priceCurrency: null,
        requestedMinor: null,
        baseMinor: null,
      };
      byProduct.set(row.id, item);
    }

    if (row.amountMinor === null || row.currency === null) {
      continue;
    }

    if (row.currency === currency) {
      item.requestedMinor =
        item.requestedMinor === null
          ? row.amountMinor
          : Math.min(item.requestedMinor, row.amountMinor);
    } else if (row.currency === BASE_CURRENCY) {
      item.baseMinor =
        item.baseMinor === null
          ? row.amountMinor
          : Math.min(item.baseMinor, row.amountMinor);
    }
  }

  return [...byProduct.values()].map((item) => {
    const useRequested = item.requestedMinor !== null;
    const amount = useRequested ? item.requestedMinor : item.baseMinor;

    return {
      id: item.id,
      slug: item.slug,
      name: item.name,
      summary: item.summary,
      fromPriceMinor: amount,
      priceCurrency:
        amount === null ? null : useRequested ? currency : BASE_CURRENCY,
    };
  });
}
