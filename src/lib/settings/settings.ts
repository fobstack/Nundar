import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { siteSettings } from "@/db/schema";

type Db = DrizzleD1Database<typeof schema>;

/**
 * Settings an operator can change from the admin, without a redeploy.
 *
 * Each one is declared here with its default, so reading a setting that was
 * never written returns something sensible rather than undefined, and adding a
 * setting is one entry rather than a migration.
 */
export const SETTING_DEFAULTS = {
  /**
   * Where to send a security report.
   *
   * Published at `/.well-known/security.txt` (RFC 9116), which is where
   * researchers and automated scanners look. Empty means the file is not served
   * at all — a security.txt naming an address nobody reads is worse than none,
   * because it consumes a researcher's goodwill before they give up.
   */
  securityContactEmail: "",
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type Settings = Record<SettingKey, string>;

const KEYS = Object.keys(SETTING_DEFAULTS) as SettingKey[];

/** Read every setting, filling in defaults for anything never written. */
export async function getSettings(db: Db): Promise<Settings> {
  const rows = await db.select().from(siteSettings);
  const stored = new Map(rows.map((row) => [row.key, row.value]));

  return Object.fromEntries(
    KEYS.map((key) => [key, stored.get(key) ?? SETTING_DEFAULTS[key]]),
  ) as Settings;
}

export async function getSetting(db: Db, key: SettingKey): Promise<string> {
  const [row] = await db
    .select()
    .from(siteSettings)
    .where(eq(siteSettings.key, key))
    .limit(1);

  return row?.value ?? SETTING_DEFAULTS[key];
}

/**
 * A deliberately strict address check.
 *
 * This value is published to the public in security.txt, so a typo is not a
 * private inconvenience — it sends vulnerability reports into a void while
 * telling researchers someone is listening. Rejecting a few unusual but legal
 * addresses is the better error here.
 */
export function isValidEmail(value: string): boolean {
  if (value.length === 0 || value.length > 254) {
    return false;
  }
  if (/\s/.test(value)) {
    return false;
  }

  const parts = value.split("@");
  if (parts.length !== 2) {
    return false;
  }

  const [local, domain] = parts;
  if (local.length === 0 || local.length > 64 || domain.length === 0) {
    return false;
  }
  // A domain needs at least one dot and no leading, trailing or doubled ones
  if (!domain.includes(".") || /^[.-]|[.-]$|\.\./.test(domain)) {
    return false;
  }

  return /^[^@]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value);
}

export type SaveSettingResult =
  | { ok: true }
  | { ok: false; reason: "invalid_email" | "unknown_key" };

/**
 * Write one setting.
 *
 * Clearing a value is allowed and meaningful: an empty security contact
 * withdraws security.txt rather than publishing an empty one.
 */
export async function saveSetting(
  db: Db,
  key: string,
  rawValue: string,
): Promise<SaveSettingResult> {
  if (!KEYS.includes(key as SettingKey)) {
    return { ok: false, reason: "unknown_key" };
  }

  const value = rawValue.trim();

  if (key === "securityContactEmail" && value !== "" && !isValidEmail(value)) {
    return { ok: false, reason: "invalid_email" };
  }

  await db
    .insert(siteSettings)
    .values({ key, value, updatedAt: Math.floor(Date.now() / 1000) })
    .onConflictDoUpdate({
      target: siteSettings.key,
      set: { value, updatedAt: Math.floor(Date.now() / 1000) },
    });

  return { ok: true };
}
