import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** 商品主表：只放语言无关的数据，翻译内容一律进 productTranslations */
export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    status: text("status").notNull(), // draft | active | archived
    primaryImageKey: text("primary_image_key"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("products_slug_unique").on(table.slug),
    index("products_status_idx").on(table.status),
  ],
);

/** 商品翻译：展示内容与 SEO meta，每语言一行 */
export const productTranslations = sqliteTable(
  "product_translations",
  {
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    name: text("name").notNull(),
    summary: text("summary"),
    description: text("description"),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    seoKeywords: text("seo_keywords"),
    ogImageKey: text("og_image_key"),
    canonicalOverride: text("canonical_override"),
  },
  (table) => [primaryKey({ columns: [table.productId, table.locale] })],
);

/**
 * 产品特性：对应"产品是什么样"类长尾词
 * 例：high temperature resistant ball valve
 */
export const productFeatures = sqliteTable(
  "product_features",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    title: text("title").notNull(),
    body: text("body"),
    iconKey: text("icon_key"),
  },
  (table) => [
    index("product_features_product_locale_idx").on(
      table.productId,
      table.locale,
    ),
  ],
);

/**
 * 使用工况：对应"产品用在哪"类长尾词，可提升为独立落地页
 * 例：ball valve for offshore oil platform
 */
export const productUseCases = sqliteTable(
  "product_use_cases",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    scenarioTitle: text("scenario_title").notNull(),
    scenarioSlug: text("scenario_slug"),
    hasOwnPage: integer("has_own_page").notNull().default(0),
    body: text("body"),
    specHighlights: text("spec_highlights"), // JSON
  },
  (table) => [
    index("product_use_cases_product_locale_idx").on(
      table.productId,
      table.locale,
    ),
    // 同一商品同一语言下，独立落地页的 slug 不得重复
    uniqueIndex("product_use_cases_slug_unique").on(
      table.productId,
      table.locale,
      table.scenarioSlug,
    ),
  ],
);

export const productVariants = sqliteTable(
  "product_variants",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    stock: integer("stock").notNull().default(0),
    weightGrams: integer("weight_grams"),
    optionValues: text("option_values").notNull(), // JSON
    /** 最小起订量，默认 1 表示不设限制 */
    moq: integer("moq").notNull().default(1),
    leadTimeDaysMin: integer("lead_time_days_min"),
    leadTimeDaysMax: integer("lead_time_days_max"),
  },
  (table) => [
    uniqueIndex("product_variants_sku_unique").on(table.sku),
    index("product_variants_product_idx").on(table.productId),
  ],
);

/** 多币种价格：base 手填，auto 由汇率换算，manual 手动覆盖后不再自动重算 */
export const variantPrices = sqliteTable(
  "variant_prices",
  {
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    currency: text("currency").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    source: text("source").notNull(), // base | auto | manual
    rateUsed: real("rate_used"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.variantId, table.currency] })],
);

/** 商品图：alt 按语言存，多语言站的 alt 也是排名信号 */
export const productImages = sqliteTable(
  "product_images",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull(),
    altLocale: text("alt_locale").notNull(),
    altText: text("alt_text").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("product_images_product_idx").on(table.productId)],
);
