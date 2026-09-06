import { AdminLocalePicker } from "@/components/AdminLocalePicker";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { getAdminT } from "@/lib/admin/locale";
import { AdminSidebar, type AdminNavItem } from "../_components/AdminSidebar";

export default async function SignedInLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { locale, t } = await getAdminT();

  // Six links do not need section headings; headings at this size are chrome.
  // A rule instead marks where the work changes: keeping the catalogue correct,
  // then working through what it sold.
  const items: AdminNavItem[] = [
    { key: "overview", href: "/admin", label: t.nav.overview },
    { key: "products", href: "/admin/products", label: t.nav.products, startsGroup: true },
    { key: "translations", href: "/admin/translations", label: t.nav.translations },
    { key: "orders", href: "/admin/orders", label: t.nav.orders, startsGroup: true },
    { key: "customers", href: "/admin/customers", label: t.nav.customers },
    { key: "settings", href: "/admin/settings", label: t.nav.settings, startsGroup: true },
  ];

  return (
    <SidebarProvider>
      <AdminSidebar items={items} signOutLabel={t.nav.signOut}>
        <div className="px-2 pb-1">
          <AdminLocalePicker locale={locale} />
        </div>
      </AdminSidebar>

      <SidebarInset className="bg-muted/40">
        {/* The trigger is the only chrome in the header: on a narrow screen it
            opens the rail, on a wide one it collapses it to icons. */}
        <header className="flex h-12 items-center gap-2 px-4 md:px-8">
          <SidebarTrigger className="-ml-1" />
        </header>

        <main className="min-w-0 px-4 pb-16 md:px-8">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
