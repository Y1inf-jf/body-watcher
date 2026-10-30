"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, isActive } from "./nav";

// 手机底部固定导航(md 及以上隐藏,由 TopNav 接管)
export default function BottomTabBar() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <nav
      aria-label="主导航"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid h-[var(--tabbar-h)] grid-cols-4">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-full flex-col items-center justify-center gap-1 text-[11px] transition-colors ${
                  active
                    ? "text-ink before:absolute before:inset-x-6 before:top-0 before:h-0.5 before:bg-accent"
                    : "text-ink-3"
                }`}
              >
                <Icon size={20} strokeWidth={1.6} />
                {item.short}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
