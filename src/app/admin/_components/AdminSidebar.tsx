"use client";

import {
  Boxes,
  Languages,
  LayoutDashboard,
  LogOut,
  Receipt,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";

const ICONS = {
  overview: LayoutDashboard,
  products: Boxes,
  translations: Languages,
  orders: Receipt,
  customers: Users,
  settings: Settings,
} as const;

export type AdminNavItem = {
  key: keyof typeof ICONS;
  href: string;
  label: string;
  /** Rule above this item, marking where the kind of work changes. */
  startsGroup?: boolean;
};

export function AdminSidebar({
  items,
  signOutLabel,
  children,
}: {
  items: AdminNavItem[];
  signOutLabel: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        <Link className="text-base font-semibold tracking-tight" href="/admin">
          Nundar
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const Icon = ICONS[item.key];
                // /admin must not light up for every page beneath it; everything
                // else stays lit while you are inside its section.
                const current =
                  item.href === "/admin"
                    ? pathname === "/admin"
                    : pathname.startsWith(item.href);

                return (
                  <SidebarMenuItem key={item.href}>
                    {item.startsGroup ? <SidebarSeparator className="my-1.5" /> : null}
                    <SidebarMenuButton
                      isActive={current}
                      render={
                        <Link href={item.href}>
                          <Icon />
                          <span>{item.label}</span>
                        </Link>
                      }
                      tooltip={item.label}
                    />
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        {children}
        <SidebarMenu>
          <SidebarMenuItem>
            <form action="/admin/logout" method="post">
              <SidebarMenuButton
                render={<button type="submit" />}
                tooltip={signOutLabel}
              >
                <LogOut />
                <span>{signOutLabel}</span>
              </SidebarMenuButton>
            </form>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
