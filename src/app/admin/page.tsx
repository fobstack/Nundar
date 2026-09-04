import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/auth/guard";

export default async function AdminHome() {
  const session = await requireAdmin();
  const db = getDb();

  const [products, rates] = await Promise.all([
    db.select().from(schema.products).where(eq(schema.products.status, "active")),
    db.select().from(schema.exchangeRates),
  ]);

  const lastFetched = rates.length
    ? new Date(Math.max(...rates.map((r) => r.fetchedAt)) * 1000)
    : null;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Signed in as {session.userId} ({session.role})
      </p>

      <dl className="mt-8 grid gap-4 sm:grid-cols-3">
        <div className="rounded border border-neutral-200 bg-white p-4">
          <dt className="text-sm text-neutral-500">Active products</dt>
          <dd className="mt-1 text-2xl font-semibold">{products.length}</dd>
        </div>
        <div className="rounded border border-neutral-200 bg-white p-4">
          <dt className="text-sm text-neutral-500">Exchange rates</dt>
          <dd className="mt-1 text-2xl font-semibold">{rates.length}</dd>
        </div>
        <div className="rounded border border-neutral-200 bg-white p-4">
          <dt className="text-sm text-neutral-500">Rates updated</dt>
          <dd className="mt-1 text-sm">
            {lastFetched ? lastFetched.toISOString().slice(0, 10) : "never"}
          </dd>
        </div>
      </dl>

      <Link
        href="/admin/products"
        className="mt-8 inline-block underline underline-offset-4"
      >
        Manage products
      </Link>
    </main>
  );
}
