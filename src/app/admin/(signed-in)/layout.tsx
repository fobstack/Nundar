import Link from "next/link";
import { AdminLocalePicker } from "@/components/AdminLocalePicker";
import { getAdminT } from "@/lib/admin/locale";
import { RailNav, type RailItem } from "../_components/RailNav";

export default async function SignedInLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { locale, t } = await getAdminT();

  // Six links do not need section headings; headings at this size are chrome.
  // A hairline instead marks where the work changes: keeping the catalogue
  // correct, then working through what it sold.
  const items: RailItem[] = [
    { href: "/admin", label: t.nav.overview },
    { href: "/admin/products", label: t.nav.products, startsGroup: true },
    { href: "/admin/translations", label: t.nav.translations },
    { href: "/admin/orders", label: t.nav.orders, startsGroup: true },
    { href: "/admin/customers", label: t.nav.customers },
    { href: "/admin/settings", label: t.nav.settings, startsGroup: true },
  ];

  return (
    <div className="admin-shell">
        <aside className="admin-rail">
          <Link className="admin-rail-brand" href="/admin">
            Nundar
          </Link>

          <RailNav items={items} />

          <div className="admin-rail-foot">
            <AdminLocalePicker locale={locale} />
            <form action="/admin/logout" method="post" style={{ marginTop: "var(--a-3)" }}>
              <button
                className="admin-rail-link"
                style={{
                  background: "none",
                  border: 0,
                  cursor: "pointer",
                  font: "inherit",
                  padding: "7px 0",
                  textAlign: "left",
                  width: "100%",
                }}
                type="submit"
              >
                {t.nav.signOut}
              </button>
            </form>
          </div>
        </aside>

      <main className="admin-main">{children}</main>
    </div>
  );
}
