import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  createSession,
  destroySession,
  readSession,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/auth/session";

describe("createSession", () => {
  it("returns an opaque token that is not the user id", async () => {
    const token = await createSession(env.SESSIONS, {
      userId: "admin-1",
      role: "owner",
    });

    expect(token).not.toContain("admin-1");
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it("issues a distinct token each time", async () => {
    const a = await createSession(env.SESSIONS, {
      userId: "admin-1",
      role: "owner",
    });
    const b = await createSession(env.SESSIONS, {
      userId: "admin-1",
      role: "owner",
    });

    expect(a).not.toBe(b);
  });
});

describe("readSession", () => {
  it("resolves a valid token to its session", async () => {
    const token = await createSession(env.SESSIONS, {
      userId: "admin-7",
      role: "staff",
    });

    const session = await readSession(env.SESSIONS, token);
    expect(session).toEqual({ userId: "admin-7", role: "staff" });
  });

  it("returns null for an unknown token", async () => {
    expect(await readSession(env.SESSIONS, "no-such-token")).toBeNull();
  });

  it("returns null for an empty token instead of looking it up", async () => {
    expect(await readSession(env.SESSIONS, "")).toBeNull();
  });

  it("returns null for a token whose stored value is corrupt", async () => {
    await env.SESSIONS.put("session:corrupt", "not json");
    expect(await readSession(env.SESSIONS, "corrupt")).toBeNull();
  });
});

describe("destroySession", () => {
  it("makes the token unusable", async () => {
    const token = await createSession(env.SESSIONS, {
      userId: "admin-1",
      role: "owner",
    });

    await destroySession(env.SESSIONS, token);
    expect(await readSession(env.SESSIONS, token)).toBeNull();
  });

  it("is a no-op for an unknown token", async () => {
    await expect(
      destroySession(env.SESSIONS, "never-existed"),
    ).resolves.toBeUndefined();
  });
});

describe("session cookie policy", () => {
  it("uses a name that does not leak its purpose to scanners", () => {
    expect(SESSION_COOKIE).toBe("shopcf_admin");
  });

  it("expires within a working day rather than lingering for weeks", () => {
    expect(SESSION_TTL_SECONDS).toBeLessThanOrEqual(60 * 60 * 12);
    expect(SESSION_TTL_SECONDS).toBeGreaterThanOrEqual(60 * 60);
  });
});
