/**
 * The shop plugin for Mallok.
 *
 * Mallok provides the site: content, languages, SEO, the admin, the edge
 * cache. This plugin adds what makes it a shop: variants, prices in several
 * currencies, stock, minimum order quantities and a cart.
 *
 * Everything here is commerce logic. Nothing about pages or rendering belongs
 * in it — that is the theme's side of the boundary.
 */

import { definePlugin, type PluginContext } from 'mallok/worker';
import { renderData } from './lib/render-data.js';
import { runScheduledTick } from './lib/scheduled.js';
import shopSql from './migrations/0001_shop.sql';
import ordersSql from './migrations/0002_orders.sql';
import manifest from './plugin.json';
import { cartPage, cartUpdate } from './routes/cart.js';

async function scheduled(ctx: PluginContext): Promise<void> {
  const outcome = await runScheduledTick(ctx);
  // An idle tick is the common case and says nothing; anything else is worth
  // one structured line. None of it carries personal data.
  if (outcome.kind !== 'idle') {
    console.log(JSON.stringify({ event: 'shop_scheduled', ...outcome }));
  }
}

export const shop = definePlugin({
  manifest,
  migrations: [
    { id: 'plugin:shop:0001_shop', sql: shopSql },
    { id: 'plugin:shop:0002_orders', sql: ordersSql },
  ],
  hooks: { scheduled, renderData },
  routes: { cart: cartPage, 'cart/update': cartUpdate },
});
