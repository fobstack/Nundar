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
import { CART_ROUTE, CART_UPDATE_ROUTE, shopPath } from './paths.js';
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

/**
 * What a purge came to, as far as its answer says.
 *
 * Mallok's `purgeTags` does not reject when a purge does not happen: it
 * resolves to an object saying whether one was attempted and whether it
 * worked. A site without a purge token attempts none. Its type promises
 * nothing about that object, so it is read for exactly those two answers,
 * and anything else is taken at its word.
 */
export function purgeOutcome(
  answer: unknown,
): 'done' | 'not_attempted' | 'refused' {
  if (answer !== null && typeof answer === 'object') {
    const { attempted, ok } = answer as { attempted?: unknown; ok?: unknown };
    if (attempted === false) {
      return 'not_attempted';
    }
    if (ok === false) {
      return 'refused';
    }
  }
  return 'done';
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

/**
 * Where the cart is, in the page's language: on every page, priced or not,
 * so that a theme can link to it from its header and post a form to it. It
 * costs no query. A theme that finds no `plugins.shop` knows the shop is off.
 */
function cartAddresses(ctx: PluginRenderDataContext): {
  cart_path: string;
  cart_action: string;
} {
  const { defaultLocale } = ctx.site;
  return {
    cart_path: shopPath(CART_ROUTE, ctx.locale, defaultLocale),
    cart_action: shopPath(CART_UPDATE_ROUTE, ctx.locale, defaultLocale),
  };
}

export async function renderData(
  ctx: PluginRenderDataContext,
): Promise<Readonly<Record<string, unknown>> | undefined> {
  const cart = cartAddresses(ctx);

  if (ctx.content !== null) {
    if (ctx.content.kind !== PRODUCT_KIND) {
      return cart;
    }
    const group = ctx.content.translationGroup;
    const { variants, prices } = await readShop(ctx.db, [group]);
    // Tagged even with nothing to show: the first variant a product is given
    // has to reach a page that was rendered without one.
    const cacheTags = [productCacheTag(group)];
    const view = productView(variants, prices, ctx.locale);
    if (view === undefined) {
      return { ...cart, cacheTags };
    }
    const offers = offersFor(variants, prices, ctx.locale);
    return {
      ...cart,
      ...view,
      cacheTags,
      ...(offers === undefined ? {} : { structuredData: { offers } }),
    };
  }

  const products = ctx.items.filter((item) => item.kind === PRODUCT_KIND);
  if (products.length === 0) {
    return cart;
  }
  const groups = [...new Set(products.map((item) => item.translationGroup))];
  const { variants, prices } = await readShop(ctx.db, groups);
  const cacheTags = groups.map(productCacheTag);
  const view = listView(products, variants, prices, ctx.locale);
  return view === undefined
    ? { ...cart, cacheTags }
    : { ...cart, ...view, cacheTags };
}
