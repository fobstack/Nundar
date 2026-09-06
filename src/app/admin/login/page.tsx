import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { getAdminT } from "@/lib/admin/locale";
import { needsSetup } from "@/lib/admin/setup";
import { authenticateAdmin } from "@/lib/auth/admin";
import { currentAdmin } from "@/lib/auth/guard";
import {
  createSession,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/auth/session";
import { Card } from "../_components/ui";

export const metadata: Metadata = {
  title: "Admin sign in",
  // Admin pages must never be indexed
  robots: { index: false, follow: false },
};

async function signIn(formData: FormData) {
  "use server";

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const { env } = getCloudflareContext();
  const result = await authenticateAdmin(getDb(), env.SESSIONS, email, password);

  if (!result.ok) {
    redirect(`/admin/login?error=${result.reason}`);
  }

  const token = await createSession(env.SESSIONS, result.session);
  const store = await cookies();

  store.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    // On local http the browser discards a Secure cookie, and login then fails
    // forever with no visible cause
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  redirect("/admin");
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await currentAdmin()) {
    redirect("/admin");
  }

  // A shop with no owner has nothing to sign in to. Sending people to setup
  // instead is what makes a button deploy usable without a command line.
  if (await needsSetup(getDb())) {
    redirect("/admin/setup");
  }

  const { t } = await getAdminT();
  const { error } = await searchParams;

  const message =
    error === "locked" ? t.login.locked : error ? t.login.invalid : null;

  return (
    <main className="admin-centred">
      <div className="admin-centred-card">
        <h1
          style={{
            fontSize: "var(--a-text-2xl)",
            fontWeight: 650,
            letterSpacing: "-0.02em",
            margin: "0 0 var(--a-6)",
          }}
        >
          {t.login.title}
        </h1>

        {message ? (
          <p className="admin-error" role="alert" style={{ marginBottom: "var(--a-4)" }}>
            {message}
          </p>
        ) : null}

        <Card>
          <form action={signIn}>
            <label className="admin-label" htmlFor="email">
              {t.login.email}
              <input
                autoComplete="username"
                className="admin-input"
                id="email"
                name="email"
                required
                type="email"
              />
            </label>

            <label
              className="admin-label"
              htmlFor="password"
              style={{ display: "block", marginTop: "var(--a-4)" }}
            >
              {t.login.password}
              <input
                autoComplete="current-password"
                className="admin-input"
                id="password"
                name="password"
                required
                type="password"
              />
            </label>

            <button
              className="admin-btn admin-btn-primary"
              style={{ marginTop: "var(--a-6)", width: "100%" }}
              type="submit"
            >
              {t.login.submit}
            </button>
          </form>
        </Card>
      </div>
    </main>
  );
}
