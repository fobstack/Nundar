export type AdminRole = "owner" | "staff";

export type AdminSession = {
  userId: string;
  role: AdminRole;
};

/** A cookie name that gives away neither the stack nor its purpose */
export const SESSION_COOKIE = "nundar_admin";

/** One working day. The admin is the highest-privilege entry point, so no long-lived sessions */
export const SESSION_TTL_SECONDS = 60 * 60 * 8;

const KEY_PREFIX = "session:";

/** A 256-bit random token, base64url-encoded so it can live in a cookie */
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

  // Session contents stay server-side; the cookie carries nothing but an
  // unguessable random token. Putting the role in the cookie would let the
  // client choose its own privileges.
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
    // A corrupt stored value means not signed in, not an exception
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

/** Build the session cookie. Secure is required in production and must be omitted
 * on local http, where the browser would otherwise discard it. */
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
