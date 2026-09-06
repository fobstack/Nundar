import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getDb } from "@/db/client";
import { getAdminT } from "@/lib/admin/locale";
import { completeSetup, needsSetup } from "@/lib/admin/setup";
import { authenticateAdmin } from "@/lib/auth/admin";
import {
  createSession,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/auth/session";

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
    <main className="flex min-h-screen items-center justify-center px-5 py-8">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">{t.setup.title}</h1>
        <p className="mt-2 mb-6 text-muted-foreground">{t.setup.lead}</p>

        {message ? (
          <p
            className="mb-4 rounded-md px-4 py-3 text-sm"
            role="alert"
            style={{
              background: "var(--state-danger-soft)",
              color: "var(--state-danger)",
            }}
          >
            {message}
          </p>
        ) : null}

        <Card>
          <CardContent>
            <form action={createFirstOwner} className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="email">{t.login.email}</Label>
                <Input
                  autoComplete="username"
                  id="email"
                  name="email"
                  required
                  type="email"
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="password">{t.login.password}</Label>
                <Input
                  autoComplete="new-password"
                  id="password"
                  minLength={12}
                  name="password"
                  required
                  type="password"
                />
                <p className="text-xs text-muted-foreground">{t.setup.passwordHint}</p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="confirmPassword">{t.setup.confirm}</Label>
                <Input
                  autoComplete="new-password"
                  id="confirmPassword"
                  minLength={12}
                  name="confirmPassword"
                  required
                  type="password"
                />
              </div>

              <Button className="mt-2 w-full" type="submit">
                {t.setup.submit}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Said here rather than buried in documentation, because this is the
            moment the risk exists and the moment it stops existing. */}
        <p
          className="mt-4 rounded-md px-4 py-3 text-xs"
          style={{
            background: "var(--state-attention-soft)",
            color: "var(--state-attention)",
          }}
        >
          {t.setup.raceWarning}
        </p>
      </div>
    </main>
  );
}
