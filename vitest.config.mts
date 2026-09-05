import fs from "node:fs";
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// The test database is built from the same migration files as production, so a
// test schema can never drift away from the real one
const migrations = await readD1Migrations(
  path.join(import.meta.dirname, "drizzle/migrations"),
);

/**
 * Every theme's stylesheet, read here on the Node side because the Workers test
 * runtime has no filesystem and Vite's `?raw` does not survive the CSS
 * pipeline.
 *
 * Discovered by scanning the themes directory rather than listed by hand, so a
 * theme added later is covered by the scoping guard automatically instead of
 * only once somebody remembers to register it here.
 */
const themesDir = path.join(import.meta.dirname, "src/themes");
const themeStylesheets = Object.fromEntries(
  fs
    .readdirSync(themesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => [entry.name, path.join(themesDir, entry.name, "tokens.css")] as const)
    .filter(([, file]) => fs.existsSync(file))
    .map(([name, file]) => [name, fs.readFileSync(file, "utf8")]),
);

/**
 * Each theme's Shell source, for the same reason.
 *
 * The root class is written by hand in a theme's Shell, so copying a theme and
 * renaming its directory without renaming that class would put two themes back
 * on one scope — reviving exactly the collision the scoping fix removed. This
 * lets a test catch that without rendering, which the bare Workers runtime
 * cannot do because next/link will not load in it.
 */
const themeShells = Object.fromEntries(
  fs
    .readdirSync(themesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => [entry.name, path.join(themesDir, entry.name, "layout/Shell.tsx")] as const)
    .filter(([, file]) => fs.existsSync(file))
    .map(([name, file]) => [name, fs.readFileSync(file, "utf8")]),
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
        bindings: {
          TEST_MIGRATIONS: migrations,
          THEME_STYLESHEETS: themeStylesheets,
          THEME_SHELLS: themeShells,
        },
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
