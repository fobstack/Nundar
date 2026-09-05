export type AdminRole = "owner" | "staff";

export type AdminSession = {
  userId: string;
  role: AdminRole;
};

/** cookie 名不暴露技术栈与用途 */
export const SESSION_COOKIE = "nundar_admin";

/** 会话有效期一个工作日；后台是高权限入口，不做长期免登录 */
export const SESSION_TTL_SECONDS = 60 * 60 * 8;

const KEY_PREFIX = "session:";

/** 生成 256 位随机 token，用 base64url 编码以便进 cookie */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function createSession(
  kv: KVNamespace,
  session: AdminSession,
): Promise<string> {
  const token = newToken();

  // 会话内容存服务端，cookie 里只放不可推导的随机 token——
  // 把角色等信息塞进 cookie 会让权限可被客户端伪造
  await kv.put(`${KEY_PREFIX}${token}`, JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SECONDS,
  });

  return token;
}

export async function readSession(
  kv: KVNamespace,
  token: string,
): Promise<AdminSession | null> {
  if (!token) {
    return null;
  }

  const raw = await kv.get(`${KEY_PREFIX}${token}`);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AdminSession>;
    if (
      typeof parsed.userId === "string" &&
      (parsed.role === "owner" || parsed.role === "staff")
    ) {
      return { userId: parsed.userId, role: parsed.role };
    }
    return null;
  } catch {
    // 存储值损坏视为未登录，不抛异常
    return null;
  }
}

export async function destroySession(
  kv: KVNamespace,
  token: string,
): Promise<void> {
  if (!token) {
    return;
  }
  await kv.delete(`${KEY_PREFIX}${token}`);
}

/** 组装会话 cookie；生产环境必须带 Secure，本地 http 下则不能带否则浏览器丢弃 */
export function sessionCookie(token: string, isSecure: boolean): string {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (isSecure) {
    attrs.push("Secure");
  }
  return attrs.join("; ");
}

export function clearedSessionCookie(isSecure: boolean): string {
  const attrs = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (isSecure) {
    attrs.push("Secure");
  }
  return attrs.join("; ");
}
