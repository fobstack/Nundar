import { and, asc, eq, inArray } from "drizzle-orm";
import { BASE_CURRENCY, type Currency } from "@/config/currency";
import { isLocale, type Locale } from "@/config/locales";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";

/**
 * Pick the effective price for a SKU in a currency from the candidate rows.
 * When the requested currency has no price the base currency is used, and the
 * currency actually returned is the one fallen back to — otherwise a dollar
 * amount ends up displayed behind a euro sign.
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
  /** Lowest price across the product's SKUs; null when nothing is priced */
  fromPriceMinor: number | null;
  /**
   * The currency fromPriceMinor is actually in.
   * When the requested currency has no price we fall back to the base currency,
   * and this reports the currency fallen back to, so a dollar amount is never
   * displayed behind a euro sign.
   */
  priceCurrency: Currency | null;
};

/** List sellable products with their name in a given language and their lowest price */
export async function listActiveProducts(
  db: Db,
  locale: Locale,
  currency: Currency = BASE_CURRENCY,
): Promise<ProductListItem[]> {
  // Fetch both the requested and the base currency in one go and resolve the
  // fallback in memory, rather than querying twice
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

  // A product has several SKUs in several currencies and so yields several rows;
  // collapse them to one row per product
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
    // Malformed data should not 500 the whole product page; drop the field instead
    return null;
  }
}

/** Product detail: translations, features, use cases, SKUs and prices in one currency */
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

/** Slugs of sellable products, for generateStaticParams */
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
  /** The use-case title in this language, shown in listings and navigation */
  useCaseTitle: string;
  /** Cross-language key linking every language version of one use case, for hreflang */
  groupKey: string;
};

/**
 * Use cases that get a landing page of their own.
 * Only rows with has_own_page = 1 and a non-empty slug: a use case without
 * enough substance stays inside the product page, because forcing one into a
 * page produces thin content that drags the whole domain's quality down.
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
 * The landing-page slug of one use case in every language.
 *
 * hreflang must point at a slug that genuinely exists in the target language.
 * Use-case slugs are localised (offshore-seawater-lines /
 * offshore-seewasserleitungen / ...), so sharing one slug across languages
 * would make hreflang point at 404s — pointing crawlers straight at dead links.
 *
 * null means that slug has no landing page in that language.
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
    // A language missing its translation simply does not appear in hreflang;
    // never substitute another language's slug
    if (row.scenarioSlug && isLocale(row.locale)) {
      alternates[row.locale] = row.scenarioSlug;
    }
  }

  return alternates;
}

/** slug to updated_at, for the sitemap's lastModified */
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
