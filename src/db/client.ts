import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { cache } from "react";
import * as schema from "./schema";

export type Db = DrizzleD1Database<typeof schema>;

/**
 * Build a drizzle client from a D1 binding.
 * A pure function with no request context, so tests can hand it env.DB directly.
 */
export function createDb(d1: D1Database): Db {
  return drizzle(d1, { schema });
}

/**
 * For dynamic routes: SSR, route handlers, the admin.
 * Wrapped in React cache so one request reuses one client instance.
 */
export const getDb = cache((): Db => {
  const { env } = getCloudflareContext();
  return createDb(env.DB);
});

/**
 * For static routes: SSG and ISR, such as product and use-case pages.
 * During static generation the Cloudflare context is only reachable
 * asynchronously — getDb would find no bindings at all.
 */
export const getDbAsync = cache(async (): Promise<Db> => {
  const { env } = await getCloudflareContext({ async: true });
  return createDb(env.DB);
});
