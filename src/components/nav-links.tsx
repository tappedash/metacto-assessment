"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  count?: number;
}

// Highlights the section the current page belongs to (detail pages included).
export function NavLinks({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav className="nav" aria-label={label}>
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
            <span className={`ico i-${item.icon}`} aria-hidden="true" />
            <span className="label">{item.label}</span>
            {item.count ? <span className="count">{item.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
