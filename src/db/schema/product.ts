import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** The product table: language-independent data only. Everything translatable
 * lives in productTranslations. */
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

/** Product translations: display content and SEO metadata, one row per language */
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
 * Product features: the "what is it like" family of long-tail terms.
 * For example: high temperature resistant ball valve
 */
export const productFeatures = sqliteTable(
  "product_features",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    /**
     * Cross-language key: every language version of one feature shares a
     * group_key. Without it there is no way to tell which German row
     * corresponds to which English one, and translation completeness cannot be
     * measured at all.
     */
    groupKey: text("group_key").notNull(),
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
    uniqueIndex("product_features_group_unique").on(
      table.productId,
      table.locale,
      table.groupKey,
    ),
  ],
);

/**
 * Use cases: the "where is it used" family of long-tail terms, each of which can
 * be promoted to a landing page of its own.
 * For example: ball valve for offshore oil platform
 */
export const productUseCases = sqliteTable(
  "product_use_cases",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    /**
     * Cross-language key: every language version of one use case shares a
     * group_key. hreflang has to point at that use case's localised slug in the
     * target language; without this key the only option left is to share one
     * slug across all languages, pointing at pages that do not exist.
     */
    groupKey: text("group_key").notNull(),
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
    // Within one product and language, landing-page slugs must be unique
    uniqueIndex("product_use_cases_slug_unique").on(
      table.productId,
      table.locale,
      table.scenarioSlug,
    ),
    uniqueIndex("product_use_cases_group_unique").on(
      table.productId,
      table.locale,
      table.groupKey,
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
    /** Minimum order quantity; 1 means no minimum */
    moq: integer("moq").notNull().default(1),
    leadTimeDaysMin: integer("lead_time_days_min"),
    leadTimeDaysMax: integer("lead_time_days_max"),
  },
  (table) => [
    uniqueIndex("product_variants_sku_unique").on(table.sku),
    index("product_variants_product_idx").on(table.productId),
  ],
);

/** Prices per currency: base is entered by hand, auto is derived from exchange
 * rates, and manual is an override that recalculation never touches again. */
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

/** Product images. Alt text is stored per language, because on a multilingual
 * site alt text is a ranking signal too. */
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
