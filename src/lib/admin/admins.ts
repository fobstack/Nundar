import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import type { AdminRole } from "@/lib/auth/session";

export type AdminUserRow = {
  id: string;
  email: string;
  role: AdminRole;
  createdAt: number;
};

export async function listAdmins(db: Db): Promise<AdminUserRow[]> {
  const rows = await db
    .select({
      id: schema.adminUsers.id,
      email: schema.adminUsers.email,
      role: schema.adminUsers.role,
      createdAt: schema.adminUsers.createdAt,
    })
    .from(schema.adminUsers)
    .orderBy(desc(schema.adminUsers.createdAt));

  // An unrecognised role degrades to staff. Bad data must never grant owner rights.
  return rows.map((row) => ({
    ...row,
    role: row.role === "owner" ? "owner" : "staff",
  }));
}

export async function createAdmin(
  db: Db,
  input: { email: string; password: string; role: AdminRole },
): Promise<void> {
  const email = input.email.trim().toLowerCase();

  if (!email.includes("@")) {
    throw new Error("A valid email address is required");
  }
  // An admin account holds the whole shop, so password strength is not left to preference
  if (input.password.length < 12) {
    throw new Error("Password must be at least 12 characters");
  }

  const [existing] = await db
    .select({ id: schema.adminUsers.id })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.email, email))
    .limit(1);

  if (existing) {
    throw new Error("An administrator with that email already exists");
  }

  await db.insert(schema.adminUsers).values({
    id: crypto.randomUUID(),
    email,
    passwordHash: await hashPassword(input.password),
    role: input.role,
    createdAt: Math.floor(Date.now() / 1000),
  });
}

/**
 * Delete an administrator.
 *
 * Two limits with no way around them: you cannot delete yourself, which would
 * lock you out; and you cannot delete the last owner, which would leave the
 * shop permanently unable to change its settings or manage accounts.
 */
export async function deleteAdmin(
  db: Db,
  input: { targetId: string; actingUserId: string },
): Promise<void> {
  if (input.targetId === input.actingUserId) {
    throw new Error("You cannot remove your own account");
  }

  const admins = await listAdmins(db);
  const target = admins.find((admin) => admin.id === input.targetId);

  if (!target) {
    throw new Error("Administrator not found");
  }

  const owners = admins.filter((admin) => admin.role === "owner");
  if (target.role === "owner" && owners.length <= 1) {
    throw new Error("Cannot remove the last owner");
  }

  await db
    .delete(schema.adminUsers)
    .where(eq(schema.adminUsers.id, input.targetId));
}

export async function changeAdminRole(
  db: Db,
  input: { targetId: string; role: AdminRole; actingUserId: string },
): Promise<void> {
  if (input.targetId === input.actingUserId && input.role !== "owner") {
    // Self-demotion removes the last owner and simultaneously removes the
    // ability to undo it
    throw new Error("You cannot demote your own account");
  }

  const admins = await listAdmins(db);
  const target = admins.find((admin) => admin.id === input.targetId);

  if (!target) {
    throw new Error("Administrator not found");
  }

  const owners = admins.filter((admin) => admin.role === "owner");
  if (target.role === "owner" && input.role !== "owner" && owners.length <= 1) {
    throw new Error("Cannot demote the last owner");
  }

  await db
    .update(schema.adminUsers)
    .set({ role: input.role })
    .where(eq(schema.adminUsers.id, input.targetId));
}
