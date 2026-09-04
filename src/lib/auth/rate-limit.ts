/**
 * 登录限流：KV 计数 + TTL 自动过期。
 *
 * 后台是全站最高权限入口，没有限流的话账号密码登录等于把爆破成本降到零。
 * 计数键按邮箱而非 IP——攻击者换 IP 的成本远低于换目标账号。
 */
export const MAX_ATTEMPTS = 5;

/** 锁定窗口：达到上限后需等待这么久，或成功登录后清零 */
export const LOCKOUT_SECONDS = 15 * 60;

export function attemptKey(email: string): string {
  return `login:${email.trim().toLowerCase()}`;
}

export async function recordFailedAttempt(
  kv: KVNamespace,
  key: string,
): Promise<number> {
  const current = Number((await kv.get(key)) ?? 0);
  const next = current + 1;

  // 每次失败都刷新 TTL：持续爆破会持续锁定，而非到点自动解锁
  await kv.put(key, String(next), { expirationTtl: LOCKOUT_SECONDS });

  return next;
}

export async function isLockedOut(
  kv: KVNamespace,
  key: string,
): Promise<boolean> {
  const current = Number((await kv.get(key)) ?? 0);
  return current >= MAX_ATTEMPTS;
}

export async function clearAttempts(
  kv: KVNamespace,
  key: string,
): Promise<void> {
  await kv.delete(key);
}
