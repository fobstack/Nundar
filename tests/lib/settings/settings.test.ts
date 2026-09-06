import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import { siteSettings } from "@/db/schema";
import {
  getSetting,
  getSettings,
  isValidEmail,
  saveSetting,
  SETTING_DEFAULTS,
} from "@/lib/settings/settings";

const db = createDb(env.DB);

beforeEach(async () => {
  await db.delete(siteSettings);
});

describe("reading settings", () => {
  it("falls back to the declared default when nothing was written", async () => {
    const settings = await getSettings(db);

    expect(settings.securityContactEmail).toBe(
      SETTING_DEFAULTS.securityContactEmail,
    );
  });

  it("returns a stored value", async () => {
    await saveSetting(db, "securityContactEmail", "security@example.com");

    expect(await getSetting(db, "securityContactEmail")).toBe(
      "security@example.com",
    );
  });

  it("never returns undefined for a declared key", async () => {
    // A setting read as undefined renders as "undefined" on a page, or worse,
    // publishes "Contact: mailto:undefined" to the internet.
    const settings = await getSettings(db);

    for (const [key, value] of Object.entries(settings)) {
      expect(value, `${key} is undefined`).toBeTypeOf("string");
    }
  });
});

describe("writing settings", () => {
  it("overwrites rather than accumulating rows", async () => {
    await saveSetting(db, "securityContactEmail", "first@example.com");
    await saveSetting(db, "securityContactEmail", "second@example.com");

    const rows = await db.select().from(siteSettings);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("second@example.com");
  });

  it("trims surrounding whitespace", async () => {
    await saveSetting(db, "securityContactEmail", "  security@example.com  ");

    expect(await getSetting(db, "securityContactEmail")).toBe(
      "security@example.com",
    );
  });

  it("allows clearing, which withdraws security.txt", async () => {
    await saveSetting(db, "securityContactEmail", "security@example.com");
    const result = await saveSetting(db, "securityContactEmail", "");

    expect(result.ok).toBe(true);
    expect(await getSetting(db, "securityContactEmail")).toBe("");
  });

  it("refuses a key that is not declared", async () => {
    const result = await saveSetting(db, "arbitraryKey", "value");

    expect(result).toEqual({ ok: false, reason: "unknown_key" });
    expect(await db.select().from(siteSettings)).toHaveLength(0);
  });

  it("refuses an invalid address rather than publishing it", async () => {
    const result = await saveSetting(db, "securityContactEmail", "not-an-email");

    expect(result).toEqual({ ok: false, reason: "invalid_email" });
    expect(await getSetting(db, "securityContactEmail")).toBe("");
  });
});

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    for (const value of [
      "security@example.com",
      "security+reports@example.co.uk",
      "a.b-c@sub.example.org",
    ]) {
      expect(isValidEmail(value), value).toBe(true);
    }
  });

  it("rejects what would send reports nowhere", () => {
    // This value is published to the public, so a typo does not merely
    // inconvenience the operator — it tells researchers someone is listening
    // when nobody is.
    for (const value of [
      "",
      "no-at-sign",
      "@example.com",
      "security@",
      "security@localhost",
      "security @example.com",
      "security@example .com",
      "security@.example.com",
      "security@example..com",
      "security@example.com.",
      "two@at@example.com",
    ]) {
      expect(isValidEmail(value), `${value} should be rejected`).toBe(false);
    }
  });

  it("rejects an over-long address", () => {
    expect(isValidEmail(`${"a".repeat(250)}@example.com`)).toBe(false);
  });
});
