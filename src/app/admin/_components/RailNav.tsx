"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type RailItem = {
  href: string;
  label: string;
  /** Draw a hairline above this item, separating one kind of work from another. */
  startsGroup?: boolean;
};

/**
 * The sidebar's links.
 *
 * A client component only because marking the current page needs the pathname.
 * Everything else in the shell stays on the server.
 */
export function RailNav({ items }: { items: RailItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="admin-rail-nav">
      {items.map((item) => {
        // /admin must not light up for every page beneath it; everything else
        // should stay lit while you are inside its section.
        const current =
          item.href === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(item.href);

        return (
          <Link
            aria-current={current ? "page" : undefined}
            className={
              item.startsGroup ? "admin-rail-link admin-rail-divide" : "admin-rail-link"
            }
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
