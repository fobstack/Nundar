/**
 * The `renderData` hook: what the shop adds to a page while Mallok renders it.
 *
 * It runs on a cache miss only, and what it returns is stored with the page.
 * So a price a buyer sees was read from the database when the page was last
 * rendered, and the page says which products it depends on — the cache tags —
 * for whoever changes a price to purge.
 *
 * Mallok allows this hook one database call, and only a read. One batch of
 * two statements covers a product page and a list of twenty alike.
 */

import type { PluginRenderDataContext } from 'mallok/worker';
import {
  listView,
  offersFor,
  productView,
  type StorefrontPriceRow,
  type StorefrontVariantRow,
} from './storefront.js';

/** The kind whose pages the shop has something to say about. */
const PRODUCT_KIND = 'product';

/**
 * The cache tag of one product's pages: its translation group. Mallok puts
 * the plugin's id in front, so the page carries `p:shop:<group>`.
 *
 * A group, not a content id: variants belong to a product in every language
 * at once, and a price change has to reach all of them.
 */
export function productCacheTag(productGroup: string): string {
  return productGroup;
}

async function readShop(
  db: D1Database,
  groups: readonly string[],
): Promise<{
  variants: StorefrontVariantRow[];
  prices: StorefrontPriceRow[];
}> {
  const list = JSON.stringify(groups);
  // The stock is read to decide a state and never leaves this module: a page
  // that printed a count would have to be purged on every sale.
  const [variantResult, priceResult] = await db.batch<
    StorefrontVariantRow | StorefrontPriceRow
  >([
    db
      .prepare(
        `SELECT id, product_group, sku, option_values, moq, lead_time_min,
                lead_time_max, stock, stock_policy
         FROM p_shop_variant
         WHERE status = 'active'
           AND product_group IN (SELECT value FROM json_each(?))
         ORDER BY sort_order, sku`,
      )
      .bind(list),
    db
      .prepare(
        `SELECT p.variant_id AS variant_id, p.currency AS currency,
                p.amount_minor AS amount_minor
         FROM p_shop_price AS p
         JOIN p_shop_variant AS v ON v.id = p.variant_id
         WHERE v.status = 'active'
           AND v.product_group IN (SELECT value FROM json_each(?))`,
      )
      .bind(list),
  ]);
  return {
    variants: (variantResult?.results ?? []) as StorefrontVariantRow[],
    prices: (priceResult?.results ?? []) as StorefrontPriceRow[],
  };
}

export async function renderData(
  ctx: PluginRenderDataContext,
): Promise<Readonly<Record<string, unknown>> | undefined> {
  if (ctx.content !== null) {
    if (ctx.content.kind !== PRODUCT_KIND) {
      return undefined;
    }
    const group = ctx.content.translationGroup;
    const { variants, prices } = await readShop(ctx.db, [group]);
    // Tagged even with nothing to show: the first variant a product is given
    // has to reach a page that was rendered without one.
    const cacheTags = [productCacheTag(group)];
    const view = productView(variants, prices, ctx.locale);
    if (view === undefined) {
      return { cacheTags };
    }
    const offers = offersFor(variants, prices, ctx.locale);
    return {
      ...view,
      cacheTags,
      ...(offers === undefined ? {} : { structuredData: { offers } }),
    };
  }

  const products = ctx.items.filter((item) => item.kind === PRODUCT_KIND);
  if (products.length === 0) {
    return undefined;
  }
  const groups = [...new Set(products.map((item) => item.translationGroup))];
  const { variants, prices } = await readShop(ctx.db, groups);
  const cacheTags = groups.map(productCacheTag);
  const view = listView(products, variants, prices, ctx.locale);
  return view === undefined ? { cacheTags } : { ...view, cacheTags };
}
