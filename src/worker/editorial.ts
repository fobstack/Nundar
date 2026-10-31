/**
 * The same site with the editorial theme (`src/theme-editorial`).
 *
 * Not what this repository deploys by default: `src/worker/index.ts` is.
 * `test/theme-editorial` and `npm run preview -- --theme editorial` run this
 * one, so that the second theme is seen working with the real plugins, the
 * real content model and the real sample. A site deploys it by pointing
 * `main` in `wrangler.jsonc` here; nothing else changes.
 */

import { createMallok, defineStarter, inquiry } from 'mallok/worker';
import { shop } from '../plugins/shop/index.js';
import { sampleShop } from '../starter/index.js';
import { editorialTheme } from '../theme-editorial/index.js';

export default createMallok({
  theme: editorialTheme,
  plugins: [inquiry, shop],
  // The same sample, declared for this theme: every page of the real
  // catalogue is what the editorial tests render.
  starters: [
    defineStarter({
      ...sampleShop,
      id: 'nundar-sample-editorial',
      theme: editorialTheme.manifest.id,
    }),
  ],
});
