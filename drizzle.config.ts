import { defineConfig } from "drizzle-kit";

// drizzle-kit is used only to generate migration SQL; applying migrations is
// always `wrangler d1 migrations apply`. That is why no d1-http driver is
// configured here — and why this file needs no Cloudflare credentials at all.
export default defineConfig({
  out: "./drizzle/migrations",
  schema: "./src/db/schema/index.ts",
  dialect: "sqlite",
});
