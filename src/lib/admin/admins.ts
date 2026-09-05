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

  // 未知角色一律降级为 staff，绝不因为数据脏就放行 owner 权限
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
  // 后台账号掌握整个店铺，密码强度不能由用户随意决定
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
 * 删除管理员。
 *
 * 两条不可绕过的限制：不能删自己（会把自己锁在门外），
 * 不能删掉最后一个 owner（店铺将永远无法再修改设置和管理账号）。
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
    // 自我降级会让最后一个 owner 消失，且本人立刻失去恢复权限的能力
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
