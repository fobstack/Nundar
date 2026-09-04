import path from "node:path";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // 测试跑在真实 Workers 运行时里，而不是 Node mock —— D1 / KV / R2 的行为差异
  // （事务语义、约束报错形态）只有在真运行时里才暴露得出来
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
