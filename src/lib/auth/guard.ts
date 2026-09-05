import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readSession, SESSION_COOKIE, type AdminSession } from "./session";

/**
 * Route guards for admin pages.
 *
 * Kept separate from admin.ts because this file depends on next/headers and
 * next/navigation, which cannot be loaded inside the bare Workers test runtime.
 * Keeping the pure logic in admin.ts is what makes it testable.
 */

/** Read the current session; null when not signed in */
export async function currentAdmin(): Promise<AdminSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const { env } = getCloudflareContext();
  return readSession(env.SESSIONS, token);
}

/** Page guard: anyone not signed in goes to the login page */
export async function requireAdmin(): Promise<AdminSession> {
  const session = await currentAdmin();
  if (!session) {
    redirect("/admin/login");
  }
  return session;
}

/** Guard for owner-only functionality */
export async function requireOwner(): Promise<AdminSession> {
  const session = await requireAdmin();
  if (session.role !== "owner") {
    redirect("/admin");
  }
  return session;
}
