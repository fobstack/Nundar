import { LOCALES } from "@/config/locales";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { toMinor } from "@/lib/money";
import { SEED_PRODUCTS } from "./seed-data";

/**
 * Load the seed data. Idempotent: every write uses onConflictDoNothing, so
 * running it repeatedly produces no duplicate rows and resetting a local
 * environment stays cheap.
 */
export async function seedDatabase(db: Db): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  for (const product of SEED_PRODUCTS) {
    await db
      .insert(schema.products)
      .values({
        id: product.id,
        slug: product.slug,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    for (const locale of LOCALES) {
      const translation = product.translations[locale];
      await db
        .insert(schema.productTranslations)
        .values({
          productId: product.id,
          locale,
          name: translation.name,
          summary: translation.summary,
          description: translation.description,
          seoTitle: translation.seoTitle,
          seoDescription: translation.seoDescription,
        })
        .onConflictDoNothing();

      const features = product.features[locale];
      for (const [index, feature] of features.entries()) {
        await db
          .insert(schema.productFeatures)
          .values({
            id: `${product.id}-feature-${locale}-${index}`,
            productId: product.id,
            locale,
            groupKey: feature.groupKey,
            sortOrder: index,
            title: feature.title,
            body: feature.body,
          })
          .onConflictDoNothing();
      }

      const useCases = product.useCases[locale];
      for (const [index, useCase] of useCases.entries()) {
        await db
          .insert(schema.productUseCases)
          .values({
            id: `${product.id}-usecase-${locale}-${index}`,
            productId: product.id,
            locale,
            groupKey: useCase.groupKey,
            sortOrder: index,
            scenarioTitle: useCase.scenarioTitle,
            scenarioSlug: useCase.scenarioSlug,
            hasOwnPage: useCase.hasOwnPage ? 1 : 0,
            body: useCase.body,
          })
          .onConflictDoNothing();
      }
    }

    for (const variant of product.variants) {
      await db
        .insert(schema.productVariants)
        .values({
          id: variant.id,
          productId: product.id,
          sku: variant.sku,
          stock: variant.stock,
          optionValues: JSON.stringify(variant.optionValues),
          moq: variant.moq,
          leadTimeDaysMin: variant.leadTimeDaysMin,
          leadTimeDaysMax: variant.leadTimeDaysMax,
        })
        .onConflictDoNothing();

      // Only the base currency is seeded; EUR and GBP are derived from exchange
      // rates by the pricing engine
      await db
        .insert(schema.variantPrices)
        .values({
          variantId: variant.id,
          currency: "USD",
          amountMinor: toMinor(variant.basePriceUsd, "USD"),
          source: "base",
          updatedAt: now,
        })
        .onConflictDoNothing();
    }
  }
}
