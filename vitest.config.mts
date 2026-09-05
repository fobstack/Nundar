import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// The test database is built from the same migration files as production, so a
// test schema can never drift away from the real one
const migrations = await readD1Migrations(
  path.join(import.meta.dirname, "drizzle/migrations"),
);

export default defineConfig({
  // Tests run inside the real Workers runtime rather than a Node mock: the ways
  // D1, KV and R2 actually behave — transaction semantics, the shape of
  // constraint errors — only surface in the real thing
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Overrides main from wrangler.jsonc, which points at an OpenNext build
      // artefact that does not exist yet when tests run
      main: "./tests/worker-entry.ts",
      miniflare: {
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    setupFiles: ["./tests/apply-migrations.ts"],
  },
});
