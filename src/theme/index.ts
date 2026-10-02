/**
 * The Nundar commerce theme.
 *
 * A theme decides how the shop looks and nothing else. It has no tables and no
 * routes, and it runs no code: templates, language packs and a stylesheet.
 * Prices, stock and the cart belong to the shop plugin.
 *
 * Mallok owns hreflang, canonicals and structured data (`page.head`), so a
 * mistake here can make the site ugly but cannot damage its indexing.
 */

import { defineTheme } from 'mallok/worker';
import applicationLiquid from './layouts/application.liquid';
import articleLiquid from './layouts/article.liquid';
import baseLiquid from './layouts/base.liquid';
import collectionLiquid from './layouts/collection.liquid';
import homeLiquid from './layouts/home.liquid';
import listLiquid from './layouts/list.liquid';
import pageLiquid from './layouts/page.liquid';
import productLiquid from './layouts/product.liquid';
import deJson from './locales/de.json';
import enJson from './locales/en.json';
import esJson from './locales/es.json';
import frJson from './locales/fr.json';
import cardLiquid from './partials/card.liquid';
import footerLiquid from './partials/footer.liquid';
import headerLiquid from './partials/header.liquid';
import manifest from './theme.json';

export const nundarTheme = defineTheme(manifest, {
  'layouts/base.liquid': baseLiquid,
  'layouts/home.liquid': homeLiquid,
  'layouts/page.liquid': pageLiquid,
  'layouts/article.liquid': articleLiquid,
  'layouts/product.liquid': productLiquid,
  'layouts/application.liquid': applicationLiquid,
  'layouts/collection.liquid': collectionLiquid,
  'layouts/list.liquid': listLiquid,
  'partials/header.liquid': headerLiquid,
  'partials/footer.liquid': footerLiquid,
  'partials/card.liquid': cardLiquid,
  'locales/en.json': JSON.stringify(enJson),
  'locales/de.json': JSON.stringify(deJson),
  'locales/fr.json': JSON.stringify(frJson),
  'locales/es.json': JSON.stringify(esJson),
});
