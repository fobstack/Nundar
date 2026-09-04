import { and, eq, inArray } from "drizzle-orm";
import { BASE_CURRENCY, type Currency } from "@/config/currency";
import type { Locale } from "@/config/locales";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { sumMinor } from "@/lib/money";
import type { CartLine } from "./cart";

export type PricedLine = {
  variantId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
};

export type CartIssue =
  | { kind: "empty" }
  | { kind: "unavailable"; variantId: string }
  | { kind: "no_price"; variantId: string }
  | { kind: "below_moq"; variantId: string; moq: number; requested: number }
  | {
      kind: "insufficient_stock";
      variantId: string;
      available: number;
      requested: number;
    };

export type PricedCart =
  | {
      ok: true;
      currency: Currency;
      lines: PricedLine[];
      subtotalMinor: number;
    }
  | { ok: false; issues: CartIssue[] };

/**
 * 按数据库当前数据给购物车定价并校验。
 *
 * 这是结账前的唯一权威计算：价格、库存、MOQ 全部在这里重新取值，
 * 前端传来的任何金额都不参与。所有问题一次性返回，避免用户改一个报一个。
 *
 * 币种回落：请求币种缺价时整单回落到基准币种并如实返回——
 * 绝不能按美元金额向用户收欧元。
 */
export async function priceCart(
  db: Db,
  lines: CartLine[],
  locale: Locale,
  currency: Currency,
): Promise<PricedCart> {
  if (lines.length === 0) {
    return { ok: false, issues: [{ kind: "empty" }] };
  }

  const variantIds = lines.map((line) => line.variantId);

  const rows = await db
    .select({
      variantId: schema.productVariants.id,
      sku: schema.productVariants.sku,
      stock: schema.productVariants.stock,
      moq: schema.productVariants.moq,
      status: schema.products.status,
      name: schema.productTranslations.name,
    })
    .from(schema.productVariants)
    .innerJoin(
      schema.products,
      eq(schema.products.id, schema.productVariants.productId),
    )
    .innerJoin(
      schema.productTranslations,
      and(
        eq(schema.productTranslations.productId, schema.products.id),
        eq(schema.productTranslations.locale, locale),
      ),
    )
    .where(inArray(schema.productVariants.id, variantIds));

  const priceRows = await db
    .select()
    .from(schema.variantPrices)
    .where(
      and(
        inArray(schema.variantPrices.variantId, variantIds),
        inArray(schema.variantPrices.currency, [currency, BASE_CURRENCY]),
      ),
    );

  // 整单只用一个币种结算：只要有任一行缺请求币种的价格，全单回落到基准币种，
  // 否则会出现同一订单里混着两种币种的金额
  const everyLineHasRequested = variantIds.every((variantId) =>
    priceRows.some(
      (price) => price.variantId === variantId && price.currency === currency,
    ),
  );
  const settleCurrency: Currency = everyLineHasRequested
    ? currency
    : BASE_CURRENCY;

  const issues: CartIssue[] = [];
  const priced: PricedLine[] = [];

  for (const line of lines) {
    const variant = rows.find((row) => row.variantId === line.variantId);

    if (!variant || variant.status !== "active") {
      issues.push({ kind: "unavailable", variantId: line.variantId });
      continue;
    }

    if (line.quantity < variant.moq) {
      issues.push({
        kind: "below_moq",
        variantId: line.variantId,
        moq: variant.moq,
        requested: line.quantity,
      });
      continue;
    }

    if (line.quantity > variant.stock) {
      issues.push({
        kind: "insufficient_stock",
        variantId: line.variantId,
        available: variant.stock,
        requested: line.quantity,
      });
      continue;
    }

    const price = priceRows.find(
      (row) =>
        row.variantId === line.variantId && row.currency === settleCurrency,
    );

    if (!price) {
      issues.push({ kind: "no_price", variantId: line.variantId });
      continue;
    }

    priced.push({
      variantId: line.variantId,
      sku: variant.sku,
      name: variant.name,
      quantity: line.quantity,
      unitPriceMinor: price.amountMinor,
      lineTotalMinor: price.amountMinor * line.quantity,
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    currency: settleCurrency,
    lines: priced,
    subtotalMinor: sumMinor(priced.map((line) => line.lineTotalMinor)),
  };
}
