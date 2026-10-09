/**
 * The shop plugin for Mallok.
 *
 * Mallok provides the site: content, languages, SEO, the admin, the edge
 * cache. This plugin adds what makes it a shop: variants, prices in several
 * currencies, stock, minimum order quantities, a cart, and the cart sent as
 * an inquiry.
 *
 * Everything here is commerce logic. Nothing about pages or rendering belongs
 * in it — that is the theme's side of the boundary.
 */

import {
  type ContentDeleteRef,
  definePlugin,
  type PluginContext,
} from 'mallok/worker';
import { exportShopFiles } from './lib/export.js';
import {
  deleteInquiries,
  exportInquiries,
  markInquiries,
} from './lib/inquiry-admin.js';
import { INQUIRY_EMAILS_JOB, sendInquiryEmails } from './lib/inquiry-jobs.js';
import { renderData } from './lib/render-data.js';
import { runScheduledTick } from './lib/scheduled.js';
import {
  loadVariant,
  onProductDeleted,
  removeVariant,
  saveVariant,
} from './lib/variant-records.js';
import shopSql from './migrations/0001_shop.sql';
import ordersSql from './migrations/0002_orders.sql';
import inquiriesSql from './migrations/0003_inquiries.sql';
import manifest from './plugin.json';
import { cartPage, cartUpdate } from './routes/cart.js';
import { cartInquiry } from './routes/inquiry.js';

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
    { id: 'plugin:shop:0003_inquiries', sql: inquiriesSql },
  ],
  hooks: {
    scheduled,
    renderData,
    onContentDelete: (ref: ContentDeleteRef, ctx: PluginContext) =>
      onProductDeleted(ref, ctx),
  },
  records: {
    variants: {
      load: loadVariant,
      save: (record, ctx) => saveVariant(record, ctx),
      remove: (id, ctx) => removeVariant(id, ctx),
    },
  },
  // What the shop holds travels with a site export: leaving Mallok must not
  // mean leaving the catalogue, the orders or the inquiries behind.
  exportFiles: (ctx: PluginContext) =>
    exportShopFiles(ctx.db, { defaultLocale: ctx.site.defaultLocale }),
  routes: {
    cart: cartPage,
    'cart/update': cartUpdate,
    'cart/inquiry': cartInquiry,
  },
  jobs: {
    [INQUIRY_EMAILS_JOB]: (payload, ctx) => sendInquiryEmails(payload, ctx),
  },
  actions: {
    inquiry_mark_answered: (ids, ctx) => markInquiries(ids, ctx, 'answered'),
    inquiry_mark_new: (ids, ctx) => markInquiries(ids, ctx, 'new'),
    inquiry_mark_spam: (ids, ctx) => markInquiries(ids, ctx, 'spam'),
    inquiry_export_csv: (ids, ctx) => exportInquiries(ids, ctx),
    inquiry_delete: (ids, ctx, params) => deleteInquiries(ids, ctx, params),
  },
});
