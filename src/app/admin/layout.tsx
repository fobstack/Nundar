import type { Metadata } from "next";
import Link from "next/link";
import { AdminLocalePicker } from "@/components/AdminLocalePicker";
import { getAdminT } from "@/lib/admin/locale";

export const metadata: Metadata = {
  // Nothing in the admin is indexed; robots.txt disallows /admin as well, and both
  // belts are deliberate
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { locale, t } = await getAdminT();

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-4">
          <Link href="/admin" className="font-semibold">
            Nundar
          </Link>

          <nav className="flex flex-1 items-center gap-5 text-sm">
            <Link href="/admin" className="hover:underline">
              {t.nav.overview}
            </Link>
            <Link href="/admin/products" className="hover:underline">
              {t.nav.products}
            </Link>
            <Link href="/admin/orders" className="hover:underline">
              {t.nav.orders}
            </Link>
            <Link href="/admin/customers" className="hover:underline">
              {t.nav.customers}
            </Link>
            <Link href="/admin/translations" className="hover:underline">
              {t.nav.translations}
            </Link>
            <Link href="/admin/settings" className="hover:underline">
              {t.nav.settings}
            </Link>
          </nav>

          <div className="flex items-center gap-4 text-sm">
            <AdminLocalePicker locale={locale} />
            <form action="/admin/logout" method="post">
              <button type="submit" className="hover:underline">
                {t.nav.signOut}
              </button>
            </form>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
