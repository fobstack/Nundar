/**
 * The shop plugin for Mallok.
 *
 * Mallok provides the site: content, languages, SEO, the admin, the edge
 * cache. This plugin adds what makes it a shop: variants, prices in several
 * currencies, stock, minimum order quantities, a cart, the cart sent as an
 * inquiry, and checkout: shipping zones, the order, payment with Stripe, and
 * what a seller does with an order afterwards.
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
import {
  cancelOrders,
  deliverOrders,
  fulfilOrders,
  refundOrders,
  refundRefusedPayments,
  shipOrders,
} from './lib/order-admin.js';
import { FOLLOW_UP_JOB, followUpJob } from './lib/order-follow-up.js';
import { renderData } from './lib/render-data.js';
import { runScheduledTick } from './lib/scheduled.js';
import {
  loadShippingZone,
  removeShippingZone,
  saveShippingZone,
} from './lib/shipping-records.js';
import {
  checkStripeSecretKey,
  checkStripeWebhookSecret,
} from './lib/stripe-check.js';
import {
  loadVariant,
  onProductDeleted,
  removeVariant,
  saveVariant,
} from './lib/variant-records.js';
import shopSql from './migrations/0001_shop.sql';
import ordersSql from './migrations/0002_orders.sql';
import inquiriesSql from './migrations/0003_inquiries.sql';
import checkoutSql from './migrations/0004_checkout.sql';
import storefrontSql from './migrations/0005_storefront.sql';
import reviewSql from './migrations/0006_review.sql';
import manifest from './plugin.json';
import { cartPage, cartUpdate } from './routes/cart.js';
import { checkoutPage, checkoutPlace } from './routes/checkout.js';
import { cartInquiry } from './routes/inquiry.js';
import { orderPage } from './routes/order.js';
import { ordersLink, ordersPage } from './routes/orders.js';
import { stripeWebhook } from './routes/stripe-webhook.js';

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
    { id: 'plugin:shop:0004_checkout', sql: checkoutSql },
    { id: 'plugin:shop:0005_storefront', sql: storefrontSql },
    { id: 'plugin:shop:0006_review', sql: reviewSql },
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
    shipping: {
      load: loadShippingZone,
      save: (record, ctx) => saveShippingZone(record, ctx),
      remove: removeShippingZone,
    },
  },
  // What the shop holds travels with a site export: leaving Mallok must not
  // mean leaving the catalogue, the orders or the inquiries behind.
  exportFiles: (ctx: PluginContext) =>
    exportShopFiles(ctx.db, {
      defaultLocale: ctx.site.defaultLocale,
      settings: ctx.settings,
    }),
  routes: {
    cart: cartPage,
    'cart/update': cartUpdate,
    'cart/inquiry': cartInquiry,
    checkout: checkoutPage,
    'checkout/place': checkoutPlace,
    'order/:orderNo': orderPage,
    orders: ordersPage,
    'orders/link': ordersLink,
    'stripe/webhook': stripeWebhook,
  },
  jobs: {
    [INQUIRY_EMAILS_JOB]: (payload, ctx) => sendInquiryEmails(payload, ctx),
    [FOLLOW_UP_JOB]: (payload, ctx) => followUpJob(payload, ctx),
  },
  checkSecrets: {
    stripe_secret_key: (ctx: PluginContext) => checkStripeSecretKey(ctx),
    stripe_webhook_secret: (ctx: PluginContext) =>
      checkStripeWebhookSecret(ctx),
  },
  actions: {
    inquiry_mark_answered: (ids, ctx) => markInquiries(ids, ctx, 'answered'),
    inquiry_mark_new: (ids, ctx) => markInquiries(ids, ctx, 'new'),
    inquiry_mark_spam: (ids, ctx) => markInquiries(ids, ctx, 'spam'),
    inquiry_export_csv: (ids, ctx) => exportInquiries(ids, ctx),
    inquiry_delete: (ids, ctx, params) => deleteInquiries(ids, ctx, params),
    order_ship: (ids, ctx, params) => shipOrders(ids, ctx, params),
    order_deliver: (ids, ctx) => deliverOrders(ids, ctx),
    order_fulfil: (ids, ctx, params) => fulfilOrders(ids, ctx, params),
    order_refund: (ids, ctx, params) => refundOrders(ids, ctx, params),
    order_cancel: (ids, ctx, params) => cancelOrders(ids, ctx, params),
    payment_refund: (ids, ctx, params) =>
      refundRefusedPayments(ids, ctx, params),
  },
});
