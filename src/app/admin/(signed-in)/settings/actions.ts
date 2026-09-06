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
import { saveSetting } from "@/lib/settings/settings";

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  role: z.enum(["owner", "staff"]),
});

const targetSchema = z.object({ targetId: z.string().min(1) });

export async function createAdminAction(formData: FormData) {
  // Account management is owner-only: if staff can create accounts, staff can
  // promote themselves
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

/**
 * Save the security contact address.
 *
 * Owner-only like everything else on this page: the address is published to the
 * public at /.well-known/security.txt, so being able to change it is being able
 * to redirect vulnerability reports.
 */
export async function saveSecurityContactAction(
  _previous: { error?: string; saved?: boolean } | null,
  formData: FormData,
): Promise<{ error?: string; saved?: boolean }> {
  await requireOwner();

  const value = z
    .object({ securityContactEmail: z.string().max(254) })
    .parse({ securityContactEmail: formData.get("securityContactEmail") ?? "" });

  const result = await saveSetting(
    getDb(),
    "securityContactEmail",
    value.securityContactEmail,
  );

  if (!result.ok) {
    return { error: result.reason };
  }

  revalidatePath("/admin/settings");
  // security.txt is served dynamically, so nothing else needs invalidating
  return { saved: true };
}
