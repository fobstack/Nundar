import { and, eq, ne } from "drizzle-orm";
import { BASE_CURRENCY, type Currency } from "@/config/currency";
import { DEFAULT_LOCALE, type Locale } from "@/config/locales";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";

/** Characters a URL segment may contain: lowercase letters, digits, hyphens */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Bump updated_at after a content change, so the sitemap's lastModified follows */
async function touchProduct(db: Db, productId: string): Promise<void> {
  await db
    .update(schema.products)
    .set({ updatedAt: nowSeconds() })
    .where(eq(schema.products.id, productId));
}

/**
 * Create a product.
 *
 * Asks for the minimum that can exist: a slug, a name in the default language,
 * and one SKU. Everything else — other languages, features, use cases, images,
 * prices in other currencies — is filled in from the edit page. Demanding it
 * all up front stalls whoever is entering the catalogue before they have
 * anything to show for it.
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
    // A new product starts as a draft. Publishing before it has images or
    // content in the other languages means the crawler's first look at the page
    // is at an incomplete one.
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

/** Publish and unpublish. Going live requires at least a name in the default
 * language, so no page ships without a title. */
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
 * Change the base price.
 *
 * Also drops every auto price for that SKU: they were derived from the old base
 * price, and leaving them in place means displaying prices that are simply
 * wrong. Manual prices are untouched — those are a decision made about a
 * specific market, and they outrank any conversion from the base.
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

/** Override the price in one currency; that row stops taking part in rate recalculation */
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

/** Drop a manual price and hand the row back to rate conversion; the next cron run fills it in */
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
 * Toggle whether a use case gets a landing page of its own.
 *
 * Turning it on requires a valid slug. Without one there is no URL, the page
 * 404s, and the sitemap lists it anyway — handing the crawler a dead link.
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
