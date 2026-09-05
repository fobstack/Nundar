import { asc, eq, inArray } from "drizzle-orm";
import type { Currency } from "@/config/currency";
import { LOCALES, type Locale } from "@/config/locales";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";

export type AdminTranslation = {
  locale: Locale;
  name: string | null;
  summary: string | null;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
};

export type AdminUseCase = {
  id: string;
  locale: Locale;
  groupKey: string;
  scenarioTitle: string;
  scenarioSlug: string | null;
  hasOwnPage: boolean;
};

export type AdminVariantPrice = {
  currency: Currency;
  amountMinor: number;
  source: "base" | "auto" | "manual";
  rateUsed: number | null;
  updatedAt: number;
};

export type AdminVariant = {
  id: string;
  sku: string;
  stock: number;
  moq: number;
  leadTimeDaysMin: number | null;
  leadTimeDaysMax: number | null;
  prices: AdminVariantPrice[];
};

export type AdminImage = {
  id: string;
  objectKey: string;
  altLocale: string;
  altText: string;
  sortOrder: number;
};

export type AdminProduct = {
  id: string;
  slug: string;
  status: string;
  images: AdminImage[];
  translations: AdminTranslation[];
  useCases: AdminUseCase[];
  variants: AdminVariant[];
};

function isLocaleValue(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/** 后台编辑页用的全量数据：所有语言、所有 SKU、所有币种价格 */
export async function getAdminProduct(
  db: Db,
  slug: string,
): Promise<AdminProduct | null> {
  const [product] = await db
    .select()
    .from(schema.products)
    .where(eq(schema.products.slug, slug))
    .limit(1);

  if (!product) {
    return null;
  }

  const [translationRows, useCaseRows, variantRows, imageRows] = await Promise.all([
    db
      .select()
      .from(schema.productTranslations)
      .where(eq(schema.productTranslations.productId, product.id)),
    db
      .select()
      .from(schema.productUseCases)
      .where(eq(schema.productUseCases.productId, product.id))
      .orderBy(
        asc(schema.productUseCases.locale),
        asc(schema.productUseCases.sortOrder),
      ),
    db
      .select()
      .from(schema.productVariants)
      .where(eq(schema.productVariants.productId, product.id))
      .orderBy(asc(schema.productVariants.sku)),
    db
      .select()
      .from(schema.productImages)
      .where(eq(schema.productImages.productId, product.id))
      .orderBy(asc(schema.productImages.sortOrder)),
  ]);

  const priceRows = variantRows.length
    ? await db
        .select()
        .from(schema.variantPrices)
        .where(
          inArray(
            schema.variantPrices.variantId,
            variantRows.map((v) => v.id),
          ),
        )
    : [];

  // 缺翻译的语言也要出现在编辑页里，否则运营根本看不到该补哪一门
  const translations: AdminTranslation[] = LOCALES.map((locale) => {
    const row = translationRows.find((t) => t.locale === locale);
    return {
      locale,
      name: row?.name ?? null,
      summary: row?.summary ?? null,
      description: row?.description ?? null,
      seoTitle: row?.seoTitle ?? null,
      seoDescription: row?.seoDescription ?? null,
    };
  });

  return {
    id: product.id,
    slug: product.slug,
    status: product.status,
    images: imageRows,
    translations,
    useCases: useCaseRows.flatMap((row) =>
      isLocaleValue(row.locale)
        ? [
            {
              id: row.id,
              locale: row.locale,
              groupKey: row.groupKey,
              scenarioTitle: row.scenarioTitle,
              scenarioSlug: row.scenarioSlug,
              hasOwnPage: row.hasOwnPage === 1,
            },
          ]
        : [],
    ),
    variants: variantRows.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      stock: variant.stock,
      moq: variant.moq,
      leadTimeDaysMin: variant.leadTimeDaysMin,
      leadTimeDaysMax: variant.leadTimeDaysMax,
      prices: priceRows
        .filter((price) => price.variantId === variant.id)
        .map((price) => ({
          currency: price.currency as Currency,
          amountMinor: price.amountMinor,
          source: price.source as AdminVariantPrice["source"],
          rateUsed: price.rateUsed,
          updatedAt: price.updatedAt,
        })),
    })),
  };
}
