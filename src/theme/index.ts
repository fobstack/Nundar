/**
 * The Nundar commerce theme.
 *
 * A theme decides how the shop looks and nothing else. It has no tables and no
 * routes: templates, language packs, a stylesheet and its fonts. Prices, stock
 * and the cart belong to the shop plugin.
 *
 * Mallok owns hreflang, canonicals and structured data (`page.head`), so a
 * mistake here can make the site ugly but cannot damage its indexing.
 */

import { defineTheme } from 'mallok/worker';
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
import toolLiquid from './layouts/tool.liquid';
import deJson from './locales/de.json';
import enJson from './locales/en.json';
import esJson from './locales/es.json';
import frJson from './locales/fr.json';
import calculatorsLiquid from './partials/calculators.liquid';
import cardLiquid from './partials/card.liquid';
import closingLiquid from './partials/closing.liquid';
import crumbsLiquid from './partials/crumbs.liquid';
import currencyLiquid from './partials/currency.liquid';
import footerLiquid from './partials/footer.liquid';
import headerLiquid from './partials/header.liquid';
import iconLiquid from './partials/icon.liquid';
import offerLiquid from './partials/offer.liquid';
import specTableLiquid from './partials/spec-table.liquid';
import manifest from './theme.json';

export const nundarTheme = defineTheme(manifest, {
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
  'partials/header.liquid': headerLiquid,
  'partials/footer.liquid': footerLiquid,
  'partials/card.liquid': cardLiquid,
  'partials/calculators.liquid': calculatorsLiquid,
  'partials/closing.liquid': closingLiquid,
  'partials/crumbs.liquid': crumbsLiquid,
  'partials/currency.liquid': currencyLiquid,
  'partials/icon.liquid': iconLiquid,
  'partials/offer.liquid': offerLiquid,
  'partials/spec-table.liquid': specTableLiquid,
  'locales/en.json': JSON.stringify(enJson),
  'locales/de.json': JSON.stringify(deJson),
  'locales/fr.json': JSON.stringify(frJson),
  'locales/es.json': JSON.stringify(esJson),
});
