import { asc, eq } from "drizzle-orm";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/config/locales";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";

export type FieldStatus = {
  field: string;
  /** Whether the source (default) language has content */
  sourceFilled: boolean;
  /** Whether the target language has content */
  targetFilled: boolean;
};

export type ContentBlockStatus = {
  groupKey: string;
  sourceTitle: string | null;
  targetTitle: string | null;
  /** Present in the source language, absent in the target — awaiting translation */
  missing: boolean;
};

export type ProductTranslationStatus = {
  productId: string;
  slug: string;
  sourceName: string | null;
  targetName: string | null;
  fields: FieldStatus[];
  features: ContentBlockStatus[];
  useCases: ContentBlockStatus[];
  /** 0-100: the share of entries with source content that have been translated */
  completeness: number;
};

/** The shape features and use cases share: groupKey is what links them across languages */
type TranslatableBlock = {
  productId: string;
  locale: string;
  groupKey: string;
};

const TRANSLATABLE_FIELDS = [
  "name",
  "summary",
  "description",
  "seoTitle",
  "seoDescription",
] as const;

function filled(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Measure how complete a target language is against the source (default) one.
 *
 * The real cost of a multilingual site is not building it, it is keeping N
 * language versions in sync afterwards. Add one use case and, without this
 * view, nobody knows which languages have not caught up — over time the
 * versions inevitably drift apart.
 *
 * Completeness counts only entries that have source content. A field left empty
 * in the source language is not a missing translation.
 */
export async function getTranslationStatus(
  db: Db,
  targetLocale: Locale,
  sourceLocale: Locale = DEFAULT_LOCALE,
): Promise<ProductTranslationStatus[]> {
  const [products, translations, features, useCases] = await Promise.all([
    db
      .select()
      .from(schema.products)
      .where(eq(schema.products.status, "active"))
      .orderBy(asc(schema.products.slug)),
    db.select().from(schema.productTranslations),
    db.select().from(schema.productFeatures),
    db.select().from(schema.productUseCases),
  ]);

  return products.map((product) => {
    const source = translations.find(
      (row) => row.productId === product.id && row.locale === sourceLocale,
    );
    const target = translations.find(
      (row) => row.productId === product.id && row.locale === targetLocale,
    );

    const fields: FieldStatus[] = TRANSLATABLE_FIELDS.map((field) => ({
      field,
      sourceFilled: filled(source?.[field]),
      targetFilled: filled(target?.[field]),
    }));

    const blockStatus = <T extends TranslatableBlock>(
      rows: T[],
      titleOf: (row: T) => string,
    ): ContentBlockStatus[] => {
      const own = rows.filter((row) => row.productId === product.id);
      const groupKeys = [
        ...new Set(
          own
            .filter((row) => row.locale === sourceLocale)
            .map((row) => row.groupKey),
        ),
      ];

      return groupKeys.map((groupKey) => {
        const sourceRow = own.find(
          (row) => row.locale === sourceLocale && row.groupKey === groupKey,
        );
        const targetRow = own.find(
          (row) => row.locale === targetLocale && row.groupKey === groupKey,
        );

        return {
          groupKey,
          sourceTitle: sourceRow ? titleOf(sourceRow) : null,
          targetTitle: targetRow ? titleOf(targetRow) : null,
          missing: Boolean(sourceRow) && !targetRow,
        };
      });
    };

    const featureStatus = blockStatus(features, (row) => row.title);
    const useCaseStatus = blockStatus(useCases, (row) => row.scenarioTitle);

    const expected =
      fields.filter((field) => field.sourceFilled).length +
      featureStatus.length +
      useCaseStatus.length;

    const done =
      fields.filter((field) => field.sourceFilled && field.targetFilled)
        .length +
      featureStatus.filter((block) => !block.missing).length +
      useCaseStatus.filter((block) => !block.missing).length;

    return {
      productId: product.id,
      slug: product.slug,
      sourceName: source?.name ?? null,
      targetName: target?.name ?? null,
      fields,
      features: featureStatus,
      useCases: useCaseStatus,
      // Nothing in the source language means nothing to translate: 100, not 0/0
      completeness: expected === 0 ? 100 : Math.round((done / expected) * 100),
    };
  });
}

/** Per-language completeness overview, for the translation workbench's landing view */
export async function getLocaleCoverage(
  db: Db,
): Promise<{ locale: Locale; completeness: number }[]> {
  const coverage: { locale: Locale; completeness: number }[] = [];

  for (const locale of LOCALES) {
    if (locale === DEFAULT_LOCALE) {
      coverage.push({ locale, completeness: 100 });
      continue;
    }

    const statuses = await getTranslationStatus(db, locale);
    const average = statuses.length
      ? Math.round(
          statuses.reduce((sum, item) => sum + item.completeness, 0) /
            statuses.length,
        )
      : 100;

    coverage.push({ locale, completeness: average });
  }

  return coverage;
}
