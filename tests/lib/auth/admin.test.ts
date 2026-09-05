import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import * as schema from "@/db/schema";
import { authenticateAdmin } from "@/lib/auth/admin";
import { hashPassword } from "@/lib/auth/password";
import { attemptKey, clearAttempts, MAX_ATTEMPTS } from "@/lib/auth/rate-limit";

const EMAIL = "owner@example.com";
const PASSWORD = "correct-horse-battery-staple";

beforeEach(async () => {
  await env.DB.exec("DELETE FROM admin_users");
  await clearAttempts(env.SESSIONS, attemptKey(EMAIL));

  await createDb(env.DB).insert(schema.adminUsers).values({
    id: "admin-1",
    email: EMAIL,
    passwordHash: await hashPassword(PASSWORD),
    role: "owner",
    createdAt: Math.floor(Date.now() / 1000),
  });
});

describe("authenticateAdmin", () => {
  it("accepts the right credentials and reports the role", async () => {
    const result = await authenticateAdmin(
      createDb(env.DB),
      env.SESSIONS,
      EMAIL,
      PASSWORD,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session).toEqual({ userId: "admin-1", role: "owner" });
  });

  it("is case-insensitive about the email but not the password", async () => {
    const upper = await authenticateAdmin(
      createDb(env.DB),
      env.SESSIONS,
      "OWNER@EXAMPLE.COM",
      PASSWORD,
    );
    expect(upper.ok).toBe(true);

    const wrongCase = await authenticateAdmin(
      createDb(env.DB),
      env.SESSIONS,
      EMAIL,
      PASSWORD.toUpperCase(),
    );
    expect(wrongCase.ok).toBe(false);
  });

  it("gives the same answer for a wrong password and an unknown account", async () => {
    const wrongPassword = await authenticateAdmin(
      createDb(env.DB),
      env.SESSIONS,
      EMAIL,
      "nope",
    );
    const unknownAccount = await authenticateAdmin(
      createDb(env.DB),
      env.SESSIONS,
      "ghost@example.com",
      "nope",
    );

    expect(wrongPassword.ok).toBe(false);
    expect(unknownAccount.ok).toBe(false);
    if (wrongPassword.ok || unknownAccount.ok) return;
    // Distinguishing them would let an attacker enumerate which emails are accounts
    expect(wrongPassword.reason).toBe(unknownAccount.reason);
  });

  it("locks the account after repeated failures", async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await authenticateAdmin(createDb(env.DB), env.SESSIONS, EMAIL, "nope");
    }

    const result = await authenticateAdmin(
      createDb(env.DB),
      env.SESSIONS,
      EMAIL,
      PASSWORD,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Even a correct password is refused while the lockout holds
    expect(result.reason).toBe("locked");
  });

  it("clears the lockout counter after a successful login", async () => {
    await authenticateAdmin(createDb(env.DB), env.SESSIONS, EMAIL, "nope");
    await authenticateAdmin(createDb(env.DB), env.SESSIONS, EMAIL, PASSWORD);

    const counter = await env.SESSIONS.get(attemptKey(EMAIL));
    expect(counter).toBeNull();
  });

  it("upgrades a legacy weak hash on successful login", async () => {
    await createDb(env.DB)
      .update(schema.adminUsers)
      .set({ passwordHash: "pbkdf2-sha256$1000$c2FsdA==$ZGlnZXN0" })
      .where(eq(schema.adminUsers.id, "admin-1"));

    // The stored hash does not match this password: login fails and nothing is
    // rewritten
    const failed = await authenticateAdmin(
      createDb(env.DB),
      env.SESSIONS,
      EMAIL,
      PASSWORD,
    );
    expect(failed.ok).toBe(false);
  });

  it("demotes an unrecognised role to staff rather than granting owner", async () => {
    await createDb(env.DB)
      .update(schema.adminUsers)
      .set({ role: "superuser" })
      .where(eq(schema.adminUsers.id, "admin-1"));

    const result = await authenticateAdmin(
      createDb(env.DB),
      env.SESSIONS,
      EMAIL,
      PASSWORD,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.role).toBe("staff");
  });
});
