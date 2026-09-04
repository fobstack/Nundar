import { defineConfig } from "drizzle-kit";

// 只用 drizzle-kit 生成迁移 SQL；迁移的应用一律交给 wrangler d1 migrations apply，
// 因此这里不配置 d1-http driver，也就不需要任何 Cloudflare 凭据。
export default defineConfig({
  out: "./drizzle/migrations",
  schema: "./src/db/schema/index.ts",
  dialect: "sqlite",
});
