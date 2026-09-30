import { describe, expect, it, vi } from "vitest";
import { hashPassword, needsRehash, verifyPassword } from "@/lib/auth/password";

/** A genuine hash at any iteration count, built directly with WebCrypto */
async function hashAt(password: string, iterations: number): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  return ["pbkdf2-sha256", iterations, toBase64(salt), toBase64(new Uint8Array(bits))].join(
    "$",
  );
}

describe("hashPassword", () => {
  it("produces a self-describing encoded string", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const [scheme, iterations, salt, digest] = hash.split("$");

    expect(scheme).toBe("pbkdf2-sha256");
    // Never weaker than the 50,000 chosen to fit the Workers Free CPU budget
    expect(Number(iterations)).toBeGreaterThanOrEqual(50_000);
    expect(salt.length).toBeGreaterThan(0);
    expect(digest.length).toBeGreaterThan(0);
  });

  it("stays within the Workers platform ceiling of 100,000 iterations", async () => {
    // Production Workers refuse PBKDF2 above 100,000 iterations and the local
    // workerd does not, so this assertion is the only thing standing between a
    // higher value and a sign-in that passes every test and fails in production
    const [, iterations] = (await hashPassword("anything")).split("$");
    expect(Number(iterations)).toBeLessThanOrEqual(100_000);
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

  it("refuses a hash above the platform ceiling, even with the right password", async () => {
    // Built at the 210,000 this module used to write. The local workerd derives
    // it without complaint, but production refuses it, so it must fail here too
    // — otherwise sign-in works locally and never in production
    const legacy = await hashAt("s3cret-passphrase", 210_000);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      expect(await verifyPassword("s3cret-passphrase", legacy)).toBe(false);

      // The operator is told how to recover, and the log carries no secret
      const logged = warn.mock.calls.flat().join(" ");
      expect(logged).toContain("pnpm admin:create");
      expect(logged).not.toContain("s3cret-passphrase");
    } finally {
      warn.mockRestore();
    }
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
