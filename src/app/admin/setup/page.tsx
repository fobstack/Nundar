import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getAdminT } from "@/lib/admin/locale";
import { completeSetup, needsSetup } from "@/lib/admin/setup";
import { authenticateAdmin } from "@/lib/auth/admin";
import {
  createSession,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/auth/session";
import { Card } from "../_components/ui";

export const metadata: Metadata = {
  title: "Set up Nundar",
  robots: { index: false, follow: false },
};

async function createFirstOwner(formData: FormData) {
  "use server";

  const db = getDb();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  const result = await completeSetup(db, { email, password, confirmPassword });

  if (!result.ok) {
    redirect(`/admin/setup?error=${result.reason}`);
  }

  // Sign the new owner straight in. Making someone who just chose a password
  // type it again to reach the page they were already going to is friction with
  // nothing behind it.
  const { env } = getCloudflareContext();
  const auth = await authenticateAdmin(db, env.SESSIONS, email, password);

  if (auth.ok) {
    const token = await createSession(env.SESSIONS, auth.session);
    const store = await cookies();
    store.set({
      name: SESSION_COOKIE,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
  }

  redirect("/admin");
}

export default async function AdminSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // Once a shop has an owner this page must not exist. Anything else lets a
  // later visitor make themselves a second owner of a running shop.
  if (!(await needsSetup(getDb()))) {
    redirect("/admin/login");
  }

  const { t } = await getAdminT();
  const { error } = await searchParams;

  const message =
    error === "password_mismatch"
      ? t.setup.mismatch
      : error === "weak_password"
        ? t.setup.weak
        : error === "invalid_email"
          ? t.setup.invalidEmail
          : error
            ? t.setup.alreadyDone
            : null;

  return (
    <main className="admin-centred">
      <div className="admin-centred-card">
        <h1
          style={{
            fontSize: "var(--a-text-2xl)",
            fontWeight: 650,
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          {t.setup.title}
        </h1>
        <p style={{ color: "var(--a-ink-2)", margin: "8px 0 var(--a-6)" }}>
          {t.setup.lead}
        </p>

        {message ? (
          <p className="admin-error" role="alert" style={{ marginBottom: "var(--a-4)" }}>
            {message}
          </p>
        ) : null}

        <Card>
          <form action={createFirstOwner}>
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
                autoComplete="new-password"
                className="admin-input"
                id="password"
                minLength={12}
                name="password"
                required
                type="password"
              />
            </label>
            <p className="admin-hint">{t.setup.passwordHint}</p>

            <label
              className="admin-label"
              htmlFor="confirmPassword"
              style={{ display: "block", marginTop: "var(--a-4)" }}
            >
              {t.setup.confirm}
              <input
                autoComplete="new-password"
                className="admin-input"
                id="confirmPassword"
                minLength={12}
                name="confirmPassword"
                required
                type="password"
              />
            </label>

            <button
              className="admin-btn admin-btn-primary"
              style={{ marginTop: "var(--a-6)", width: "100%" }}
              type="submit"
            >
              {t.setup.submit}
            </button>
          </form>
        </Card>

        {/* Said here rather than buried in documentation, because this is the
            moment the risk exists and the moment it stops existing. */}
        <p className="admin-hint" style={{ marginTop: "var(--a-4)" }}>
          {t.setup.raceWarning}
        </p>
      </div>
    </main>
  );
}
