import { cookies } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { destroySession, SESSION_COOKIE } from "@/lib/auth/session";

export async function POST(request: Request) {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value ?? "";

  // Delete the session server-side rather than only clearing the cookie: a leaked
  // token would otherwise still work
  const { env } = getCloudflareContext();
  await destroySession(env.SESSIONS, token);
  store.delete(SESSION_COOKIE);

  return Response.redirect(new URL("/admin/login", request.url), 303);
}
