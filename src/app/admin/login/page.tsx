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
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
    <main className="flex min-h-screen items-center justify-center px-5 py-8">
      <div className="w-full max-w-md">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">
          {t.login.title}
        </h1>

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
            <form action={signIn} className="grid gap-4">
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
                  autoComplete="current-password"
                  id="password"
                  name="password"
                  required
                  type="password"
                />
              </div>

              <Button className="mt-2 w-full" type="submit">
                {t.login.submit}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
