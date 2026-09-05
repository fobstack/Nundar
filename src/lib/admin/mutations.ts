import { and, eq, ne } from "drizzle-orm";
import { BASE_CURRENCY, type Currency } from "@/config/currency";
import { DEFAULT_LOCALE, type Locale } from "@/config/locales";
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

/**
 * 创建商品。
 *
 * 只要求最小可用集合：slug + 默认语言的名称 + 一个 SKU。其余内容（其他语言、
 * 特性、工况、图片、多币种价格）在编辑页逐步补齐——建商品时就要求填全，
 * 会让运营在录入阶段就卡住。
 */
export async function createProduct(
  db: Db,
  input: {
    slug: string;
    name: string;
    locale: Locale;
    sku: string;
    basePriceMinor: number;
    stock: number;
    moq: number;
  },
): Promise<{ id: string; slug: string }> {
  const slug = input.slug.trim().toLowerCase();

  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      "Slug must be lowercase letters, digits and hyphens (used directly in the URL)",
    );
  }
  if (!input.name.trim()) {
    throw new Error("Product name must not be empty");
  }
  if (!input.sku.trim()) {
    throw new Error("SKU must not be empty");
  }
  if (!Number.isInteger(input.basePriceMinor) || input.basePriceMinor < 0) {
    throw new Error("Price must be a non-negative integer in minor units");
  }
  if (!Number.isInteger(input.moq) || input.moq < 1) {
    throw new Error("MOQ must be at least 1");
  }
  if (!Number.isInteger(input.stock) || input.stock < 0) {
    throw new Error("Stock must be a non-negative integer");
  }

  const [existing] = await db
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(eq(schema.products.slug, slug))
    .limit(1);

  if (existing) {
    throw new Error(`A product with the slug "${slug}" already exists`);
  }

  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const now = nowSeconds();

  await db.insert(schema.products).values({
    id: productId,
    slug,
    // 新商品先落草稿：还没有图、没有其他语言内容就直接上架，
    // 等于让爬虫先抓到一个残缺页面
    status: "draft",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.productTranslations).values({
    productId,
    locale: input.locale,
    name: input.name.trim(),
  });

  await db.insert(schema.productVariants).values({
    id: variantId,
    productId,
    sku: input.sku.trim(),
    stock: input.stock,
    optionValues: "{}",
    moq: input.moq,
  });

  await db.insert(schema.variantPrices).values({
    variantId,
    currency: BASE_CURRENCY,
    amountMinor: input.basePriceMinor,
    source: "base",
    updatedAt: now,
  });

  return { id: productId, slug };
}

/** 上下架。草稿转在售前要求至少有默认语言的名称，避免出现无标题页面。 */
export async function setProductStatus(
  db: Db,
  productId: string,
  status: "draft" | "active" | "archived",
): Promise<void> {
  if (status === "active") {
    const [translation] = await db
      .select({ name: schema.productTranslations.name })
      .from(schema.productTranslations)
      .where(
        and(
          eq(schema.productTranslations.productId, productId),
          eq(schema.productTranslations.locale, DEFAULT_LOCALE),
        ),
      )
      .limit(1);

    if (!translation?.name?.trim()) {
      throw new Error(
        `Cannot publish without a ${DEFAULT_LOCALE.toUpperCase()} product name`,
      );
    }
  }

  await db
    .update(schema.products)
    .set({ status, updatedAt: nowSeconds() })
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
