import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import { adminUsers } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { completeSetup, needsSetup } from "@/lib/admin/setup";

const db = createDb(env.DB);

const VALID = {
  email: "owner@example.com",
  password: "a-long-enough-password",
  confirmPassword: "a-long-enough-password",
};

beforeEach(async () => {
  await db.delete(adminUsers);
});

describe("needsSetup", () => {
  it("is true while the shop has no administrator", async () => {
    expect(await needsSetup(db)).toBe(true);
  });

  it("is false once one exists", async () => {
    await completeSetup(db, VALID);
    expect(await needsSetup(db)).toBe(false);
  });
});

describe("completeSetup", () => {
  it("creates the first account as an owner", async () => {
    expect(await completeSetup(db, VALID)).toEqual({ ok: true });

    const rows = await db.select().from(adminUsers);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("owner@example.com");
    // Anything less would leave the shop unable to manage its own settings
    expect(rows[0].role).toBe("owner");
  });

  it("stores a verifiable hash, never the password", async () => {
    await completeSetup(db, VALID);
    const [row] = await db.select().from(adminUsers);

    expect(row.passwordHash).not.toContain(VALID.password);
    expect(await verifyPassword(VALID.password, row.passwordHash)).toBe(true);
    expect(await verifyPassword("something-else-entirely", row.passwordHash)).toBe(false);
  });

  it("refuses once an administrator exists", async () => {
    await completeSetup(db, VALID);

    const second = await completeSetup(db, {
      email: "intruder@example.com",
      password: "another-long-password",
      confirmPassword: "another-long-password",
    });

    // Without this, anyone reaching the page later becomes an owner of a
    // running shop
    expect(second).toEqual({ ok: false, reason: "already_set_up" });
    expect(await db.select().from(adminUsers)).toHaveLength(1);
  });

  it("refuses a mismatched confirmation", async () => {
    // There is no password reset without a command line, so a typo here locks
    // the operator out of the shop they just deployed
    const result = await completeSetup(db, {
      ...VALID,
      confirmPassword: "a-long-enough-passwerd",
    });

    expect(result).toEqual({ ok: false, reason: "password_mismatch" });
    expect(await db.select().from(adminUsers)).toHaveLength(0);
  });

  it("refuses a short password", async () => {
    const result = await completeSetup(db, {
      email: "owner@example.com",
      password: "short",
      confirmPassword: "short",
    });

    expect(result).toEqual({ ok: false, reason: "weak_password" });
    expect(await db.select().from(adminUsers)).toHaveLength(0);
  });

  it("refuses an address that is not one", async () => {
    for (const email of ["", "no-at-sign", "has space@example.com"]) {
      const result = await completeSetup(db, { ...VALID, email });
      expect(result, email).toEqual({ ok: false, reason: "invalid_email" });
    }
    expect(await db.select().from(adminUsers)).toHaveLength(0);
  });

  it("normalises the address, so case cannot create a second owner", async () => {
    await completeSetup(db, { ...VALID, email: "  Owner@Example.COM  " });

    const [row] = await db.select().from(adminUsers);
    expect(row.email).toBe("owner@example.com");
  });
});
