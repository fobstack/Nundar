import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { cache } from "react";
import * as schema from "./schema";

export type Db = DrizzleD1Database<typeof schema>;

/**
 * 由一个 D1 绑定构造 drizzle 客户端。
 * 纯函数、不依赖请求上下文，因此测试里可以直接传 env.DB 使用。
 */
export function createDb(d1: D1Database): Db {
  return drizzle(d1, { schema });
}

/**
 * 动态路由用（SSR、Route Handler、后台）。
 * 用 React cache 包一层，同一请求内复用同一个客户端实例。
 */
export const getDb = cache((): Db => {
  const { env } = getCloudflareContext();
  return createDb(env.DB);
});

/**
 * 静态路由用（SSG / ISR，如商品页与工况落地页）。
 * 静态生成期间取 Cloudflare 上下文必须走异步形态，用 getDb 会拿不到绑定。
 */
export const getDbAsync = cache(async (): Promise<Db> => {
  const { env } = await getCloudflareContext({ async: true });
  return createDb(env.DB);
});
