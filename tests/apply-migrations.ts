import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";

declare global {
  // 全局命名空间的声明合并没有 ES module 等价写法，此处必须用 namespace
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cloudflare {
    // cloudflare:test 的 env 类型即 Cloudflare.Env（由 wrangler types 生成），
    // 这里并入测试专用绑定
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

// 每个测试 worker 启动时把迁移灌进隔离的测试 D1。
// 迁移数组由 vitest.config.mts 经 TEST_MIGRATIONS 绑定注入。
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
