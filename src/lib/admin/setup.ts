import { count } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { adminUsers } from "@/db/schema";
import { createAdmin } from "./admins";

type Db = DrizzleD1Database<typeof schema>;

/**
 * First-run setup.
 *
 * A shop deployed with the Deploy to Cloudflare button has no command line, so
 * `pnpm admin:create` is not reachable — its operator could not get into their
 * own admin at all. This closes that, without the thing it obviously must not
 * be: a default account. Shipping known credentials in a public repository is
 * CWE-1392, and every deployment would share one password an attacker can read
 * rather than guess.
 *
 * The trade this makes instead is a race: between deploying and completing
 * setup, whoever reaches the page first claims the shop. That window is minutes
 * long on an address nobody has been told about yet, and it is the same trade
 * Ghost, Discourse and Directus make. It is a real risk, not an absent one, and
 * the setup page says so.
 */

/** Whether the shop still has no administrator, and setup should be reachable. */
export async function needsSetup(db: Db): Promise<boolean> {
  const [row] = await db.select({ total: count() }).from(adminUsers);
  return (row?.total ?? 0) === 0;
}

export type SetupResult =
  | { ok: true }
  | { ok: false; reason: "already_set_up" | "invalid_email" | "weak_password" | "password_mismatch" };

/**
 * Create the first owner.
 *
 * Re-checks emptiness immediately before writing rather than trusting the
 * caller's earlier check. Two people submitting this form at once would
 * otherwise both pass a guard taken seconds ago, and the second would silently
 * become a second owner of someone else's shop.
 */
export async function completeSetup(
  db: Db,
  input: { email: string; password: string; confirmPassword: string },
): Promise<SetupResult> {
  if (!(await needsSetup(db))) {
    return { ok: false, reason: "already_set_up" };
  }

  const email = input.email.trim().toLowerCase();
  if (!email.includes("@") || /\s/.test(email)) {
    return { ok: false, reason: "invalid_email" };
  }

  if (input.password.length < 12) {
    return { ok: false, reason: "weak_password" };
  }

  // Checked here rather than only in the browser: this password cannot be
  // reset without a command line, so a typo locks the operator out of the shop
  // they just deployed.
  if (input.password !== input.confirmPassword) {
    return { ok: false, reason: "password_mismatch" };
  }

  await createAdmin(db, { email, password: input.password, role: "owner" });

  if (!(await needsSetup(db))) {
    return { ok: true };
  }

  // createAdmin returning without an account existing would mean the write was
  // lost; reporting success would strand the operator on a login page whose
  // credentials do not work.
  return { ok: false, reason: "already_set_up" };
}
