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
 * Verify an admin login.
 *
 * An unknown account and a wrong password return the same reason, so the error
 * message cannot be used to enumerate valid accounts. Either kind of failure
 * counts towards the rate limit.
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

  // If the stored hash uses outdated parameters, upgrade it now while the
  // plaintext password is in hand
  if (needsRehash(user.passwordHash)) {
    await db
      .update(schema.adminUsers)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(schema.adminUsers.id, user.id));
  }

  const role: AdminRole = user.role === "owner" ? "owner" : "staff";
  return { ok: true, session: { userId: user.id, role } };
}
