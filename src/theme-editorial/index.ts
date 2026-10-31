/**
 * The editorial theme: a second look for the same shop.
 *
 * It exists to keep the boundary honest. The commerce theme is one way to
 * draw what Mallok and the shop plugin hand a theme; a contract with one
 * implementation is only a guess. This one reads the same content model,
 * the same options and the same plugin views, and draws them the opposite
 * way — serif type on paper, the industries and notes before the catalogue,
 * no script, no file of its own — and its tests hold every page whole.
 *
 * Its words are the commerce theme's packs. Interface wording is the shop's
 * to get right once, not each theme's to translate again; what differs
 * between the two is how a page looks.
 *
 * A site uses it through `src/worker/editorial.ts`, the same site built with
 * this theme. It carries its stylesheet in the page, because Mallok stages
 * the files of the theme at `src/theme` only.
 */

import { defineTheme } from 'mallok/worker';
import deJson from '../theme/locales/de.json';
import enJson from '../theme/locales/en.json';
import esJson from '../theme/locales/es.json';
import frJson from '../theme/locales/fr.json';
import applicationLiquid from './layouts/application.liquid';
import articleLiquid from './layouts/article.liquid';
import baseLiquid from './layouts/base.liquid';
import caseLiquid from './layouts/case.liquid';
import collectionLiquid from './layouts/collection.liquid';
import faqLiquid from './layouts/faq.liquid';
import faqListLiquid from './layouts/faq-list.liquid';
import homeLiquid from './layouts/home.liquid';
import listLiquid from './layouts/list.liquid';
import pageLiquid from './layouts/page.liquid';
import productLiquid from './layouts/product.liquid';
import productsLiquid from './layouts/products.liquid';
import shopCartLiquid from './layouts/shop-cart.liquid';
import shopCheckoutLiquid from './layouts/shop-checkout.liquid';
import shopOrderLiquid from './layouts/shop-order.liquid';
import shopOrdersLiquid from './layouts/shop-orders.liquid';
import toolLiquid from './layouts/tool.liquid';
import cardLiquid from './partials/card.liquid';
import catalogueLiquid from './partials/catalogue.liquid';
import closingLiquid from './partials/closing.liquid';
import crumbsLiquid from './partials/crumbs.liquid';
import entryLiquid from './partials/entry.liquid';
import footerLiquid from './partials/footer.liquid';
import headerLiquid from './partials/header.liquid';
import offerLiquid from './partials/offer.liquid';
import pagerLiquid from './partials/pager.liquid';
import styleLiquid from './partials/style.liquid';
import titleblockLiquid from './partials/titleblock.liquid';
import manifest from './theme.json';

export const editorialTheme = defineTheme(manifest, {
  'layouts/base.liquid': baseLiquid,
  'layouts/home.liquid': homeLiquid,
  'layouts/page.liquid': pageLiquid,
  'layouts/article.liquid': articleLiquid,
  'layouts/product.liquid': productLiquid,
  'layouts/products.liquid': productsLiquid,
  'layouts/collection.liquid': collectionLiquid,
  'layouts/application.liquid': applicationLiquid,
  'layouts/case.liquid': caseLiquid,
  'layouts/faq.liquid': faqLiquid,
  'layouts/faq-list.liquid': faqListLiquid,
  'layouts/tool.liquid': toolLiquid,
  'layouts/list.liquid': listLiquid,
  'layouts/shop-cart.liquid': shopCartLiquid,
  'layouts/shop-checkout.liquid': shopCheckoutLiquid,
  'layouts/shop-order.liquid': shopOrderLiquid,
  'layouts/shop-orders.liquid': shopOrdersLiquid,
  'partials/header.liquid': headerLiquid,
  'partials/footer.liquid': footerLiquid,
  'partials/crumbs.liquid': crumbsLiquid,
  'partials/entry.liquid': entryLiquid,
  'partials/card.liquid': cardLiquid,
  'partials/catalogue.liquid': catalogueLiquid,
  'partials/closing.liquid': closingLiquid,
  'partials/offer.liquid': offerLiquid,
  'partials/pager.liquid': pagerLiquid,
  'partials/style.liquid': styleLiquid,
  'partials/titleblock.liquid': titleblockLiquid,
  'locales/en.json': JSON.stringify(enJson),
  'locales/de.json': JSON.stringify(deJson),
  'locales/fr.json': JSON.stringify(frJson),
  'locales/es.json': JSON.stringify(esJson),
});
