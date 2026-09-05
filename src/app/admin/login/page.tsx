import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { authenticateAdmin } from "@/lib/auth/admin";
import { currentAdmin } from "@/lib/auth/guard";
import {
  createSession,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Admin sign in",
  // 后台页面绝不能进索引
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
    // 本地 http 下带 Secure 会被浏览器丢弃，登录就会一直失败
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

  const { error } = await searchParams;

  const message =
    error === "locked"
      ? "Too many failed attempts. Try again in 15 minutes."
      : error
        ? "Incorrect email or password."
        : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Kontor admin</h1>

      {message ? (
        <p
          role="alert"
          className="mt-6 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {message}
        </p>
      ) : null}

      <form action={signIn} className="mt-6 space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="username"
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
          />
        </div>

        <button
          type="submit"
          className="w-full rounded bg-neutral-900 px-3 py-2 text-white"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
