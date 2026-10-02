/**
 * This site's Worker.
 *
 * Everything Mallok does — routing, rendering, the management API, the admin,
 * media, SEO, migrations, the edge cache — comes from the `mallok` package at
 * the exact version in `package.json`. Upgrading is `mallok upgrade --to
 * <version>`, not a merge.
 *
 * What Nundar adds is on this page: the shop plugin, which holds the commerce
 * logic, beside Mallok's own inquiry plugin. Both are build-time choices —
 * changing either needs a deploy.
 */

import { atelier, createMallok, inquiry } from 'mallok/worker';
import { shop } from '../plugins/shop/index.js';

export default createMallok({
  theme: atelier,
  plugins: [inquiry, shop],
});
