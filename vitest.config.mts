import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// 测试库的表结构来自与生产同一份迁移文件，避免测试用的 schema 与真实 schema 漂移
const migrations = await readD1Migrations(
  path.join(import.meta.dirname, "drizzle/migrations"),
);

export default defineConfig({
  // 测试跑在真实 Workers 运行时里，而不是 Node mock —— D1 / KV / R2 的行为差异
  // （事务语义、约束报错形态）只有在真运行时里才暴露得出来
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // 覆盖 wrangler.jsonc 里的 main：那是 opennext 构建产物，跑测试时还不存在
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
