import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/**
 * The shop plugin's tests run inside the real Workers runtime, against this
 * site's own Worker entry.
 *
 * The real thing rather than a Node mock, because what the plugin depends on —
 * how a D1 batch rolls back, what a constraint failure looks like, how
 * Mallok mounts a plugin route — only behaves truthfully in workerd.
 *
 * The environment is declared here in full instead of being read from
 * `wrangler.jsonc`: reading that file would make the pool load the `.dev.vars`
 * beside it, which is a developer's local secrets, in a test run.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: 'src/worker/index.ts',
      miniflare: {
        compatibilityDate: '2026-08-01',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: ['DB'],
        r2Buckets: ['MEDIA'],
        bindings: {
          MALLOK_SECRET: 'test-secret-do-not-use',
          MALLOK_SITE: 'test',
          // Lets a test create the administrator without a one-time setup
          // key. A deployed site never has this.
          MALLOK_DEV_ALLOW_SETUP_WITHOUT_KEY: 'true',
        },
        // The same Text rule `wrangler.jsonc` declares: migrations and theme
        // files are imported as strings.
        modulesRules: [
          {
            type: 'Text',
            include: ['**/*.liquid', '**/*.css', '**/*.sql', '**/*.md'],
            fallthrough: true,
          },
        ],
      },
    }),
  ],
  test: {
    include: ['test/shop/**/*.test.ts'],
  },
});
