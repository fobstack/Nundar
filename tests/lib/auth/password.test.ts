import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, verifyPassword } from "@/lib/auth/password";

describe("hashPassword", () => {
  it("produces a self-describing encoded string", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const [scheme, iterations, salt, digest] = hash.split("$");

    expect(scheme).toBe("pbkdf2-sha256");
    expect(Number(iterations)).toBeGreaterThanOrEqual(100_000);
    expect(salt.length).toBeGreaterThan(0);
    expect(digest.length).toBeGreaterThan(0);
  });

  it("salts each hash, so the same password never yields the same digest", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");

    expect(a).not.toBe(b);
  });

  it("rejects an empty password rather than storing a hash of nothing", async () => {
    await expect(hashPassword("")).rejects.toThrow(/password/i);
  });
});

describe("verifyPassword", () => {
  it("accepts the correct password", async () => {
    const hash = await hashPassword("s3cret-passphrase");
    expect(await verifyPassword("s3cret-passphrase", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("s3cret-passphrase");
    expect(await verifyPassword("wrong-passphrase", hash)).toBe(false);
  });

  it("rejects a password differing only in case", async () => {
    const hash = await hashPassword("CaseSensitive");
    expect(await verifyPassword("casesensitive", hash)).toBe(false);
  });

  it("returns false for a malformed stored hash instead of throwing", async () => {
    expect(await verifyPassword("whatever", "not-a-real-hash")).toBe(false);
    expect(await verifyPassword("whatever", "")).toBe(false);
  });

  it("handles unicode passwords", async () => {
    const hash = await hashPassword("密码-with-émoji-🔐");
    expect(await verifyPassword("密码-with-émoji-🔐", hash)).toBe(true);
    expect(await verifyPassword("密码-with-emoji-🔐", hash)).toBe(false);
  });
});

describe("needsRehash", () => {
  it("flags hashes weaker than the current iteration count", () => {
    expect(needsRehash("pbkdf2-sha256$1000$salt$digest")).toBe(true);
  });

  it("leaves current hashes alone", async () => {
    const hash = await hashPassword("current");
    expect(needsRehash(hash)).toBe(false);
  });

  it("flags an unrecognised scheme for rehashing", () => {
    expect(needsRehash("argon2id$x$y$z")).toBe(true);
  });
});
