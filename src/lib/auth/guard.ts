import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readSession, SESSION_COOKIE, type AdminSession } from "./session";

/**
 * 后台页面守卫。
 *
 * 与 admin.ts 分开的原因：这里依赖 next/headers 与 next/navigation，
 * 而那些模块在纯 Workers 测试运行时里加载不了；把纯逻辑留在 admin.ts 才能测。
 */

/** 读取当前登录态；未登录返回 null */
export async function currentAdmin(): Promise<AdminSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const { env } = getCloudflareContext();
  return readSession(env.SESSIONS, token);
}

/** 后台页面守卫：未登录一律跳登录页 */
export async function requireAdmin(): Promise<AdminSession> {
  const session = await currentAdmin();
  if (!session) {
    redirect("/admin/login");
  }
  return session;
}

/** owner 专属功能守卫 */
export async function requireOwner(): Promise<AdminSession> {
  const session = await requireAdmin();
  if (session.role !== "owner") {
    redirect("/admin");
  }
  return session;
}
