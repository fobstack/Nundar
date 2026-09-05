import { asc, eq } from "drizzle-orm";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/config/locales";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";

export type FieldStatus = {
  field: string;
  /** 源语言（默认语言）下是否有内容 */
  sourceFilled: boolean;
  /** 目标语言下是否有内容 */
  targetFilled: boolean;
};

export type ContentBlockStatus = {
  groupKey: string;
  sourceTitle: string | null;
  targetTitle: string | null;
  /** 源语言有、目标语言没有 —— 待翻译 */
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
  /** 0–100，源语言有内容的条目中已翻译的比例 */
  completeness: number;
};

/** 特性与工况共有的结构：靠 groupKey 跨语言对应 */
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
 * 统计某目标语言相对源语言（默认语言）的翻译完整度。
 *
 * 多语言站真正的成本不是建站，是持续维护 N 个语言版本的内容同步：
 * 加了一条工况后，没有这个视图就不知道哪几门语言还没跟上，长期必然内容漂移。
 *
 * 完整度只统计"源语言有内容"的条目——源语言本身就空的字段不该算作缺翻译。
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
      // 源语言没有任何内容时视为无需翻译，记 100 而非 0/0
      completeness: expected === 0 ? 100 : Math.round((done / expected) * 100),
    };
  });
}

/** 各语言的整体完整度概览，用于工作台首屏 */
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
