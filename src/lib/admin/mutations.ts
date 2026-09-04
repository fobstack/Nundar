import { and, eq, ne } from "drizzle-orm";
import { BASE_CURRENCY, type Currency } from "@/config/currency";
import type { Locale } from "@/config/locales";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";

/** URL 片段允许的字符：小写字母、数字、连字符 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** 内容变更后推进 updated_at，sitemap 的 lastModified 才会跟着动 */
async function touchProduct(db: Db, productId: string): Promise<void> {
  await db
    .update(schema.products)
    .set({ updatedAt: nowSeconds() })
    .where(eq(schema.products.id, productId));
}

export type TranslationInput = {
  name: string;
  summary: string | null;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
};

export async function saveProductTranslation(
  db: Db,
  productId: string,
  locale: Locale,
  input: TranslationInput,
): Promise<void> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Product name must not be empty");
  }

  const values = {
    productId,
    locale,
    name,
    summary: input.summary?.trim() || null,
    description: input.description?.trim() || null,
    seoTitle: input.seoTitle?.trim() || null,
    seoDescription: input.seoDescription?.trim() || null,
  };

  await db
    .insert(schema.productTranslations)
    .values(values)
    .onConflictDoUpdate({
      target: [
        schema.productTranslations.productId,
        schema.productTranslations.locale,
      ],
      set: {
        name: values.name,
        summary: values.summary,
        description: values.description,
        seoTitle: values.seoTitle,
        seoDescription: values.seoDescription,
      },
    });

  await touchProduct(db, productId);
}

/**
 * 改基准价。
 *
 * 同时删掉该 SKU 的全部 auto 价：它们是按旧基准价算出来的，留着就等于挂着错价。
 * manual 价不动——那是运营针对具体市场的决定，优先于基准价换算。
 */
export async function updateBasePrice(
  db: Db,
  variantId: string,
  amountMinor: number,
): Promise<void> {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new Error("Price must be a non-negative integer in minor units");
  }

  const now = nowSeconds();

  await db
    .insert(schema.variantPrices)
    .values({
      variantId,
      currency: BASE_CURRENCY,
      amountMinor,
      source: "base",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.variantPrices.variantId, schema.variantPrices.currency],
      set: { amountMinor, source: "base", rateUsed: null, updatedAt: now },
    });

  await db
    .delete(schema.variantPrices)
    .where(
      and(
        eq(schema.variantPrices.variantId, variantId),
        eq(schema.variantPrices.source, "auto"),
      ),
    );
}

/** 手动覆盖某币种价格；此后该行不再参与汇率重算 */
export async function setManualPrice(
  db: Db,
  variantId: string,
  currency: Currency,
  amountMinor: number,
): Promise<void> {
  if (currency === BASE_CURRENCY) {
    throw new Error(
      "Cannot override the base currency; it is the source of truth",
    );
  }
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new Error("Price must be a non-negative integer in minor units");
  }

  const now = nowSeconds();

  await db
    .insert(schema.variantPrices)
    .values({
      variantId,
      currency,
      amountMinor,
      source: "manual",
      rateUsed: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.variantPrices.variantId, schema.variantPrices.currency],
      set: { amountMinor, source: "manual", rateUsed: null, updatedAt: now },
    });
}

/** 撤销手动定价，交还给汇率自动换算（下次 cron 会补上） */
export async function clearManualPrice(
  db: Db,
  variantId: string,
  currency: Currency,
): Promise<void> {
  await db
    .delete(schema.variantPrices)
    .where(
      and(
        eq(schema.variantPrices.variantId, variantId),
        eq(schema.variantPrices.currency, currency),
        ne(schema.variantPrices.source, "base"),
      ),
    );
}

export type LogisticsInput = {
  stock: number;
  moq: number;
  leadTimeDaysMin: number | null;
  leadTimeDaysMax: number | null;
};

export async function updateVariantLogistics(
  db: Db,
  variantId: string,
  input: LogisticsInput,
): Promise<void> {
  if (!Number.isInteger(input.stock) || input.stock < 0) {
    throw new Error("Stock must be a non-negative integer");
  }
  if (!Number.isInteger(input.moq) || input.moq < 1) {
    throw new Error("MOQ must be at least 1");
  }
  if (
    input.leadTimeDaysMin !== null &&
    input.leadTimeDaysMax !== null &&
    input.leadTimeDaysMin > input.leadTimeDaysMax
  ) {
    throw new Error("Lead time minimum must not exceed the maximum");
  }

  await db
    .update(schema.productVariants)
    .set({
      stock: input.stock,
      moq: input.moq,
      leadTimeDaysMin: input.leadTimeDaysMin,
      leadTimeDaysMax: input.leadTimeDaysMax,
    })
    .where(eq(schema.productVariants.id, variantId));
}

/**
 * 切换工况是否生成独立落地页。
 *
 * 开启时必须有合法 slug——没有 slug 就没有 URL，页面会 404，
 * 而 sitemap 又会把它收录进去，等于给爬虫送死链。
 */
export async function updateUseCasePage(
  db: Db,
  useCaseId: string,
  input: { hasOwnPage: boolean; scenarioSlug: string },
): Promise<void> {
  const slug = input.scenarioSlug.trim();

  if (input.hasOwnPage && !SLUG_PATTERN.test(slug)) {
    throw new Error(
      "A use case with its own page needs a URL-safe slug (lowercase letters, digits, hyphens)",
    );
  }

  const [useCase] = await db
    .select({ productId: schema.productUseCases.productId })
    .from(schema.productUseCases)
    .where(eq(schema.productUseCases.id, useCaseId))
    .limit(1);

  if (!useCase) {
    throw new Error(`Use case ${useCaseId} not found`);
  }

  await db
    .update(schema.productUseCases)
    .set({
      hasOwnPage: input.hasOwnPage ? 1 : 0,
      scenarioSlug: slug || null,
    })
    .where(eq(schema.productUseCases.id, useCaseId));

  await touchProduct(db, useCase.productId);
}
