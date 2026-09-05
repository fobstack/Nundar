import { and, asc, eq, inArray } from "drizzle-orm";
import { BASE_CURRENCY, type Currency } from "@/config/currency";
import { isLocale, type Locale } from "@/config/locales";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";

/**
 * 在候选价格行中挑出该 SKU 该币种的生效价。
 * 请求币种缺价时回落到基准币种，并如实返回回落后的币种——
 * 否则会把美元金额挂上欧元符号展示。
 */
function resolvePrice(
  rows: { currency: string; amountMinor: number }[],
  requested: Currency,
): { priceMinor: number | null; priceCurrency: Currency | null } {
  const exact = rows.find((row) => row.currency === requested);
  if (exact) {
    return { priceMinor: exact.amountMinor, priceCurrency: requested };
  }

  const base = rows.find((row) => row.currency === BASE_CURRENCY);
  if (base) {
    return { priceMinor: base.amountMinor, priceCurrency: BASE_CURRENCY };
  }

  return { priceMinor: null, priceCurrency: null };
}

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

export type ProductFeature = {
  id: string;
  title: string;
  body: string | null;
};

export type ProductUseCase = {
  id: string;
  scenarioTitle: string;
  scenarioSlug: string | null;
  hasOwnPage: boolean;
  body: string | null;
  specHighlights: Record<string, string> | null;
};

export type ProductVariantDetail = {
  id: string;
  sku: string;
  stock: number;
  optionValues: Record<string, string>;
  moq: number;
  leadTimeDaysMin: number | null;
  leadTimeDaysMax: number | null;
  priceMinor: number | null;
  priceCurrency: Currency | null;
};

export type ProductDetail = {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: number;
  features: ProductFeature[];
  useCases: ProductUseCase[];
  variants: ProductVariantDetail[];
};

function parseJsonRecord(value: string | null): Record<string, string> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, string>)
      : null;
  } catch {
    // 脏数据不应让整个商品页 500，退化为不展示该字段
    return null;
  }
}

/** 取商品详情：翻译、特性、工况、SKU 与该币种价格 */
export async function getProductDetail(
  db: Db,
  slug: string,
  locale: Locale,
  currency: Currency = BASE_CURRENCY,
): Promise<ProductDetail | null> {
  const [product] = await db
    .select({
      id: schema.products.id,
      slug: schema.products.slug,
      updatedAt: schema.products.updatedAt,
      name: schema.productTranslations.name,
      summary: schema.productTranslations.summary,
      description: schema.productTranslations.description,
      seoTitle: schema.productTranslations.seoTitle,
      seoDescription: schema.productTranslations.seoDescription,
    })
    .from(schema.products)
    .innerJoin(
      schema.productTranslations,
      and(
        eq(schema.productTranslations.productId, schema.products.id),
        eq(schema.productTranslations.locale, locale),
      ),
    )
    .where(
      and(eq(schema.products.slug, slug), eq(schema.products.status, "active")),
    )
    .limit(1);

  if (!product) {
    return null;
  }

  const [featureRows, useCaseRows, variantRows] = await Promise.all([
    db
      .select()
      .from(schema.productFeatures)
      .where(
        and(
          eq(schema.productFeatures.productId, product.id),
          eq(schema.productFeatures.locale, locale),
        ),
      )
      .orderBy(asc(schema.productFeatures.sortOrder)),
    db
      .select()
      .from(schema.productUseCases)
      .where(
        and(
          eq(schema.productUseCases.productId, product.id),
          eq(schema.productUseCases.locale, locale),
        ),
      )
      .orderBy(asc(schema.productUseCases.sortOrder)),
    db
      .select()
      .from(schema.productVariants)
      .where(eq(schema.productVariants.productId, product.id))
      .orderBy(asc(schema.productVariants.sku)),
  ]);

  const currencies =
    currency === BASE_CURRENCY ? [BASE_CURRENCY] : [currency, BASE_CURRENCY];

  const priceRows = variantRows.length
    ? await db
        .select({
          variantId: schema.variantPrices.variantId,
          currency: schema.variantPrices.currency,
          amountMinor: schema.variantPrices.amountMinor,
        })
        .from(schema.variantPrices)
        .where(
          and(
            inArray(
              schema.variantPrices.variantId,
              variantRows.map((v) => v.id),
            ),
            inArray(schema.variantPrices.currency, currencies),
          ),
        )
    : [];

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    summary: product.summary,
    description: product.description,
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    updatedAt: product.updatedAt,
    features: featureRows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
    })),
    useCases: useCaseRows.map((row) => ({
      id: row.id,
      scenarioTitle: row.scenarioTitle,
      scenarioSlug: row.scenarioSlug,
      hasOwnPage: row.hasOwnPage === 1,
      body: row.body,
      specHighlights: parseJsonRecord(row.specHighlights),
    })),
    variants: variantRows.map((row) => ({
      id: row.id,
      sku: row.sku,
      stock: row.stock,
      optionValues: parseJsonRecord(row.optionValues) ?? {},
      moq: row.moq,
      leadTimeDaysMin: row.leadTimeDaysMin,
      leadTimeDaysMax: row.leadTimeDaysMax,
      ...resolvePrice(
        priceRows.filter((price) => price.variantId === row.id),
        currency,
      ),
    })),
  };
}

/** 在售商品的 slug，供 generateStaticParams 使用 */
export async function listProductSlugs(db: Db): Promise<string[]> {
  const rows = await db
    .select({ slug: schema.products.slug })
    .from(schema.products)
    .where(eq(schema.products.status, "active"))
    .orderBy(asc(schema.products.slug));

  return rows.map((row) => row.slug);
}

export type UseCasePageRef = {
  productSlug: string;
  locale: Locale;
  useCaseSlug: string;
  /** 该语言下的工况标题，首页与导航列表要显示它 */
  useCaseTitle: string;
  /** 跨语言标识，用于把同一工况的各语言版本关联起来做 hreflang */
  groupKey: string;
};

/**
 * 需要生成独立落地页的工况。
 * 只取 has_own_page = 1 且 slug 非空的记录——内容不够厚的工况留在商品页内，
 * 强行成页会被判为 thin content，反而拖累整站质量评分。
 */
export async function listUseCasePages(db: Db): Promise<UseCasePageRef[]> {
  const rows = await db
    .select({
      productSlug: schema.products.slug,
      locale: schema.productUseCases.locale,
      useCaseSlug: schema.productUseCases.scenarioSlug,
      useCaseTitle: schema.productUseCases.scenarioTitle,
      groupKey: schema.productUseCases.groupKey,
    })
    .from(schema.productUseCases)
    .innerJoin(
      schema.products,
      eq(schema.products.id, schema.productUseCases.productId),
    )
    .where(
      and(
        eq(schema.products.status, "active"),
        eq(schema.productUseCases.hasOwnPage, 1),
      ),
    )
    .orderBy(asc(schema.products.slug), asc(schema.productUseCases.locale));

  return rows.flatMap((row) =>
    row.useCaseSlug && isLocale(row.locale)
      ? [
          {
            productSlug: row.productSlug,
            locale: row.locale,
            useCaseSlug: row.useCaseSlug,
            useCaseTitle: row.useCaseTitle,
            groupKey: row.groupKey,
          },
        ]
      : [],
  );
}

/**
 * 取某个工况在各语言下的落地页 slug。
 *
 * hreflang 必须指向目标语言下真实存在的 slug——各语言的工况 slug 是本地化的
 * （offshore-seawater-lines / offshore-seewasserleitungen …），若让所有语言共用
 * 同一个 slug，hreflang 会指向 404，等于把爬虫引向死链。
 *
 * 返回 null 表示该 slug 在该语言下不存在独立落地页。
 */
export async function getUseCaseAlternates(
  db: Db,
  productSlug: string,
  locale: Locale,
  useCaseSlug: string,
): Promise<Partial<Record<Locale, string>> | null> {
  const [current] = await db
    .select({
      productId: schema.productUseCases.productId,
      groupKey: schema.productUseCases.groupKey,
    })
    .from(schema.productUseCases)
    .innerJoin(
      schema.products,
      eq(schema.products.id, schema.productUseCases.productId),
    )
    .where(
      and(
        eq(schema.products.slug, productSlug),
        eq(schema.products.status, "active"),
        eq(schema.productUseCases.locale, locale),
        eq(schema.productUseCases.scenarioSlug, useCaseSlug),
        eq(schema.productUseCases.hasOwnPage, 1),
      ),
    )
    .limit(1);

  if (!current) {
    return null;
  }

  const rows = await db
    .select({
      locale: schema.productUseCases.locale,
      scenarioSlug: schema.productUseCases.scenarioSlug,
    })
    .from(schema.productUseCases)
    .where(
      and(
        eq(schema.productUseCases.productId, current.productId),
        eq(schema.productUseCases.groupKey, current.groupKey),
        eq(schema.productUseCases.hasOwnPage, 1),
      ),
    );

  const alternates: Partial<Record<Locale, string>> = {};
  for (const row of rows) {
    // 缺翻译的语言直接不出现在 hreflang 里，绝不用别的语言 slug 顶替
    if (row.scenarioSlug && isLocale(row.locale)) {
      alternates[row.locale] = row.scenarioSlug;
    }
  }

  return alternates;
}

/** slug → updated_at，供 sitemap 的 lastModified 使用 */
export async function listProductUpdatedAt(
  db: Db,
): Promise<Record<string, number>> {
  const rows = await db
    .select({
      slug: schema.products.slug,
      updatedAt: schema.products.updatedAt,
    })
    .from(schema.products)
    .where(eq(schema.products.status, "active"));

  return Object.fromEntries(rows.map((row) => [row.slug, row.updatedAt]));
}
