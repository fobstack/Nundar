"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth/guard";
import {
  changeAdminRole,
  createAdmin,
  deleteAdmin,
} from "@/lib/admin/admins";

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  role: z.enum(["owner", "staff"]),
});

const targetSchema = z.object({ targetId: z.string().min(1) });

export async function createAdminAction(formData: FormData) {
  // 账号管理是 owner 专属：staff 能造账号就等于 staff 能自我提权
  const session = await requireOwner();

  const input = createSchema.parse({
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
  });

  await createAdmin(getDb(), input);
  revalidatePath("/admin/settings");
  void session;
}

export async function deleteAdminAction(formData: FormData) {
  const session = await requireOwner();
  const { targetId } = targetSchema.parse({ targetId: formData.get("targetId") });

  await deleteAdmin(getDb(), { targetId, actingUserId: session.userId });
  revalidatePath("/admin/settings");
}

export async function changeRoleAction(formData: FormData) {
  const session = await requireOwner();
  const input = z
    .object({ targetId: z.string().min(1), role: z.enum(["owner", "staff"]) })
    .parse({ targetId: formData.get("targetId"), role: formData.get("role") });

  await changeAdminRole(getDb(), {
    targetId: input.targetId,
    role: input.role,
    actingUserId: session.userId,
  });
  revalidatePath("/admin/settings");
}
