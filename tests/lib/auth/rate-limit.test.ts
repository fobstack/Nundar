import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAttempts,
  isLockedOut,
  MAX_ATTEMPTS,
  recordFailedAttempt,
} from "@/lib/auth/rate-limit";

const KEY = "login:test@example.com";

beforeEach(async () => {
  await clearAttempts(env.SESSIONS, KEY);
});

describe("recordFailedAttempt", () => {
  it("counts attempts upwards", async () => {
    expect(await recordFailedAttempt(env.SESSIONS, KEY)).toBe(1);
    expect(await recordFailedAttempt(env.SESSIONS, KEY)).toBe(2);
  });

  it("keeps separate counters per key", async () => {
    await recordFailedAttempt(env.SESSIONS, KEY);
    expect(await recordFailedAttempt(env.SESSIONS, "login:other")).toBe(1);
    await clearAttempts(env.SESSIONS, "login:other");
  });
});

describe("isLockedOut", () => {
  it("allows attempts below the limit", async () => {
    for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) {
      await recordFailedAttempt(env.SESSIONS, KEY);
    }
    expect(await isLockedOut(env.SESSIONS, KEY)).toBe(false);
  });

  it("locks out once the limit is reached", async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await recordFailedAttempt(env.SESSIONS, KEY);
    }
    expect(await isLockedOut(env.SESSIONS, KEY)).toBe(true);
  });

  it("treats an untouched key as not locked out", async () => {
    expect(await isLockedOut(env.SESSIONS, "login:never-seen")).toBe(false);
  });
});

describe("clearAttempts", () => {
  it("unlocks after a successful login", async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await recordFailedAttempt(env.SESSIONS, KEY);
    }
    await clearAttempts(env.SESSIONS, KEY);

    expect(await isLockedOut(env.SESSIONS, KEY)).toBe(false);
  });
});

describe("lockout policy", () => {
  it("permits a few honest typos but not a brute-force run", () => {
    expect(MAX_ATTEMPTS).toBeGreaterThanOrEqual(3);
    expect(MAX_ATTEMPTS).toBeLessThanOrEqual(10);
  });
});
