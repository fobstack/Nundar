import { LOCALES } from "@/config/locales";
import { toMinor } from "@/lib/money";
import { SEED_PRODUCTS } from "./seed-data";

/**
 * SQL 字符串字面量转义：单引号翻倍，null 转 NULL。
 * 种子文案里含撇号（如法语 d'actionneur），转义写错会生成语法错误的 SQL。
 */
export function sqlString(value: string | null): string {
  if (value === null) {
    return "NULL";
  }
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * 由 SEED_PRODUCTS 生成种子 SQL，供 wrangler d1 execute 灌库。
 * 一律用 INSERT OR IGNORE，重复执行不产生重复行，与 seedDatabase 的幂等语义一致。
 *
 * 本模块刻意不引入 node:fs，以便测试能在 Workers 运行时里直接跑；
 * 落盘由 write-seed-sql.ts 负责。
 */
export function buildSeedSql(now: number): string {
  const statements: string[] = [];

  for (const product of SEED_PRODUCTS) {
    statements.push(
      `INSERT OR IGNORE INTO products (id, slug, status, created_at, updated_at) VALUES (${sqlString(product.id)}, ${sqlString(product.slug)}, 'active', ${now}, ${now});`,
    );

    for (const locale of LOCALES) {
      const t = product.translations[locale];
      statements.push(
        `INSERT OR IGNORE INTO product_translations (product_id, locale, name, summary, description, seo_title, seo_description) VALUES (${sqlString(product.id)}, ${sqlString(locale)}, ${sqlString(t.name)}, ${sqlString(t.summary)}, ${sqlString(t.description)}, ${sqlString(t.seoTitle)}, ${sqlString(t.seoDescription)});`,
      );

      product.features[locale].forEach((feature, index) => {
        statements.push(
          `INSERT OR IGNORE INTO product_features (id, product_id, locale, sort_order, title, body) VALUES (${sqlString(`${product.id}-feature-${locale}-${index}`)}, ${sqlString(product.id)}, ${sqlString(locale)}, ${index}, ${sqlString(feature.title)}, ${sqlString(feature.body)});`,
        );
      });

      product.useCases[locale].forEach((useCase, index) => {
        statements.push(
          `INSERT OR IGNORE INTO product_use_cases (id, product_id, locale, sort_order, scenario_title, scenario_slug, has_own_page, body) VALUES (${sqlString(`${product.id}-usecase-${locale}-${index}`)}, ${sqlString(product.id)}, ${sqlString(locale)}, ${index}, ${sqlString(useCase.scenarioTitle)}, ${sqlString(useCase.scenarioSlug)}, ${useCase.hasOwnPage ? 1 : 0}, ${sqlString(useCase.body)});`,
        );
      });
    }

    for (const variant of product.variants) {
      statements.push(
        `INSERT OR IGNORE INTO product_variants (id, product_id, sku, stock, option_values, moq, lead_time_days_min, lead_time_days_max) VALUES (${sqlString(variant.id)}, ${sqlString(product.id)}, ${sqlString(variant.sku)}, ${variant.stock}, ${sqlString(JSON.stringify(variant.optionValues))}, ${variant.moq}, ${variant.leadTimeDaysMin}, ${variant.leadTimeDaysMax});`,
      );
      statements.push(
        `INSERT OR IGNORE INTO variant_prices (variant_id, currency, amount_minor, source, updated_at) VALUES (${sqlString(variant.id)}, 'USD', ${toMinor(variant.basePriceUsd, "USD")}, 'base', ${now});`,
      );
    }
  }

  return `${statements.join("\n")}\n`;
}
