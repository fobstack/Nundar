/**
 * This site's Worker.
 *
 * Everything Mallok does — routing, rendering, the management API, the admin,
 * media, SEO, migrations, the edge cache — comes from the `mallok` package at
 * the exact version in `package.json`. Upgrading is `mallok upgrade --to
 * <version>`, not a merge.
 *
 * What Nundar adds is on this page:
 *
 * - the commerce theme, which decides how the shop looks;
 * - the shop plugin, which holds the commerce logic;
 * - Mallok's own inquiry plugin, for the request-a-quote form;
 * - the sample shop, as a starter the first-run wizard offers.
 *
 * All of them are build-time choices — changing any needs a deploy.
 */

import { createMallok, inquiry } from 'mallok/worker';
import { shop } from '../plugins/shop/index.js';
import { sampleShop } from '../starter/index.js';
import { nundarTheme } from '../theme/index.js';

export default createMallok({
  theme: nundarTheme,
  plugins: [inquiry, shop],
  starters: [sampleShop],
});
