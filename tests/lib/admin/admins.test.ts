import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import {
  changeAdminRole,
  createAdmin,
  deleteAdmin,
  listAdmins,
} from "@/lib/admin/admins";
import { verifyPassword } from "@/lib/auth/password";

const STRONG = "correct-horse-battery-staple";

beforeEach(async () => {
  await env.DB.exec("DELETE FROM admin_users");
});

async function seedOwner(email = "owner@example.com") {
  await createAdmin(createDb(env.DB), {
    email,
    password: STRONG,
    role: "owner",
  });
  const admins = await listAdmins(createDb(env.DB));
  return admins.find((admin) => admin.email === email)!.id;
}

describe("createAdmin", () => {
  it("stores a hashed password, never the plaintext", async () => {
    await createAdmin(createDb(env.DB), {
      email: "a@example.com",
      password: STRONG,
      role: "owner",
    });

    const [row] = await env.DB.prepare(
      "SELECT password_hash FROM admin_users",
    ).all<{ password_hash: string }>().then((r) => r.results);

    expect(row.password_hash).not.toContain(STRONG);
    expect(await verifyPassword(STRONG, row.password_hash)).toBe(true);
  });

  it("normalises the email to lowercase", async () => {
    await createAdmin(createDb(env.DB), {
      email: "  MixedCase@Example.COM ",
      password: STRONG,
      role: "staff",
    });

    const [admin] = await listAdmins(createDb(env.DB));
    expect(admin.email).toBe("mixedcase@example.com");
  });

  it("rejects a weak password, since an admin owns the whole store", async () => {
    await expect(
      createAdmin(createDb(env.DB), {
        email: "a@example.com",
        password: "short",
        role: "staff",
      }),
    ).rejects.toThrow(/12 characters/);
  });

  it("rejects an address that is not an email", async () => {
    await expect(
      createAdmin(createDb(env.DB), {
        email: "not-an-email",
        password: STRONG,
        role: "staff",
      }),
    ).rejects.toThrow(/email/i);
  });

  it("refuses a duplicate email", async () => {
    await createAdmin(createDb(env.DB), {
      email: "a@example.com",
      password: STRONG,
      role: "owner",
    });

    await expect(
      createAdmin(createDb(env.DB), {
        email: "a@example.com",
        password: STRONG,
        role: "staff",
      }),
    ).rejects.toThrow(/already exists/);
  });
});

describe("listAdmins", () => {
  it("demotes an unrecognised role to staff rather than granting owner", async () => {
    await createAdmin(createDb(env.DB), {
      email: "a@example.com",
      password: STRONG,
      role: "staff",
    });
    await env.DB.exec("UPDATE admin_users SET role = 'superuser'");

    const [admin] = await listAdmins(createDb(env.DB));
    expect(admin.role).toBe("staff");
  });
});

describe("deleteAdmin", () => {
  it("removes another administrator", async () => {
    const ownerId = await seedOwner();
    await createAdmin(createDb(env.DB), {
      email: "staff@example.com",
      password: STRONG,
      role: "staff",
    });
    const staff = (await listAdmins(createDb(env.DB))).find(
      (admin) => admin.role === "staff",
    )!;

    await deleteAdmin(createDb(env.DB), {
      targetId: staff.id,
      actingUserId: ownerId,
    });

    expect(await listAdmins(createDb(env.DB))).toHaveLength(1);
  });

  it("refuses to let you remove your own account", async () => {
    const ownerId = await seedOwner();

    // 删掉自己会把自己锁在门外
    await expect(
      deleteAdmin(createDb(env.DB), {
        targetId: ownerId,
        actingUserId: ownerId,
      }),
    ).rejects.toThrow(/your own account/i);
  });

  it("refuses to remove the last owner", async () => {
    const ownerId = await seedOwner();
    await createAdmin(createDb(env.DB), {
      email: "staff@example.com",
      password: STRONG,
      role: "staff",
    });
    const staff = (await listAdmins(createDb(env.DB))).find(
      (admin) => admin.role === "staff",
    )!;

    // staff 也不该能删掉唯一的 owner —— 店铺会永远失去设置与账号管理能力
    await expect(
      deleteAdmin(createDb(env.DB), {
        targetId: ownerId,
        actingUserId: staff.id,
      }),
    ).rejects.toThrow(/last owner/i);
  });

  it("allows removing an owner when another owner remains", async () => {
    const first = await seedOwner("one@example.com");
    await createAdmin(createDb(env.DB), {
      email: "two@example.com",
      password: STRONG,
      role: "owner",
    });
    const second = (await listAdmins(createDb(env.DB))).find(
      (admin) => admin.email === "two@example.com",
    )!;

    await deleteAdmin(createDb(env.DB), {
      targetId: second.id,
      actingUserId: first,
    });

    expect(await listAdmins(createDb(env.DB))).toHaveLength(1);
  });

  it("throws for an unknown administrator", async () => {
    const ownerId = await seedOwner();
    await expect(
      deleteAdmin(createDb(env.DB), {
        targetId: "ghost",
        actingUserId: ownerId,
      }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("changeAdminRole", () => {
  it("promotes a staff member to owner", async () => {
    const ownerId = await seedOwner();
    await createAdmin(createDb(env.DB), {
      email: "staff@example.com",
      password: STRONG,
      role: "staff",
    });
    const staff = (await listAdmins(createDb(env.DB))).find(
      (admin) => admin.role === "staff",
    )!;

    await changeAdminRole(createDb(env.DB), {
      targetId: staff.id,
      role: "owner",
      actingUserId: ownerId,
    });

    const updated = (await listAdmins(createDb(env.DB))).find(
      (admin) => admin.id === staff.id,
    )!;
    expect(updated.role).toBe("owner");
  });

  it("refuses self-demotion", async () => {
    const ownerId = await seedOwner();

    await expect(
      changeAdminRole(createDb(env.DB), {
        targetId: ownerId,
        role: "staff",
        actingUserId: ownerId,
      }),
    ).rejects.toThrow(/demote your own/i);
  });

  it("refuses to demote the last owner", async () => {
    const ownerId = await seedOwner();
    await createAdmin(createDb(env.DB), {
      email: "staff@example.com",
      password: STRONG,
      role: "staff",
    });
    const staff = (await listAdmins(createDb(env.DB))).find(
      (admin) => admin.role === "staff",
    )!;

    await expect(
      changeAdminRole(createDb(env.DB), {
        targetId: ownerId,
        role: "staff",
        actingUserId: staff.id,
      }),
    ).rejects.toThrow(/last owner/i);
  });
});
