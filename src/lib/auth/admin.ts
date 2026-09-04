import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { hashPassword, needsRehash, verifyPassword } from "./password";
import {
  attemptKey,
  clearAttempts,
  isLockedOut,
  recordFailedAttempt,
} from "./rate-limit";
import type { AdminRole, AdminSession } from "./session";

export type LoginResult =
  | { ok: true; session: AdminSession }
  | { ok: false; reason: "invalid" | "locked" };

/**
 * 校验后台登录。
 *
 * 账号不存在与密码错误返回同一个 reason，避免通过错误信息枚举出有效账号。
 * 无论哪种失败都计入限流计数。
 */
export async function authenticateAdmin(
  db: Db,
  kv: KVNamespace,
  email: string,
  password: string,
): Promise<LoginResult> {
  const key = attemptKey(email);

  if (await isLockedOut(kv, key)) {
    return { ok: false, reason: "locked" };
  }

  const [user] = await db
    .select()
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.email, email.trim().toLowerCase()))
    .limit(1);

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    await recordFailedAttempt(kv, key);
    return { ok: false, reason: "invalid" };
  }

  await clearAttempts(kv, key);

  // 存量哈希参数过旧时，趁着手上有明文密码顺手升级
  if (needsRehash(user.passwordHash)) {
    await db
      .update(schema.adminUsers)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(schema.adminUsers.id, user.id));
  }

  const role: AdminRole = user.role === "owner" ? "owner" : "staff";
  return { ok: true, session: { userId: user.id, role } };
}
