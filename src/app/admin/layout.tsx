import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  // 后台整体不进索引；robots.txt 也已 disallow /admin，双保险
  robots: { index: false, follow: false },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/admin" className="font-semibold">
            shopcf admin
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/admin/products" className="hover:underline">
              Products
            </Link>
            <Link href="/admin/orders" className="hover:underline">
              Orders
            </Link>
            <Link href="/admin/translations" className="hover:underline">
              Translations
            </Link>
            <form action="/admin/logout" method="post">
              <button type="submit" className="hover:underline">
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
