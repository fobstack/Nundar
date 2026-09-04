import { cookies } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { destroySession, SESSION_COOKIE } from "@/lib/auth/session";

export async function POST(request: Request) {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value ?? "";

  // 服务端删除会话，不只是清 cookie——否则 token 泄露后仍然可用
  const { env } = getCloudflareContext();
  await destroySession(env.SESSIONS, token);
  store.delete(SESSION_COOKIE);

  return Response.redirect(new URL("/admin/login", request.url), 303);
}
