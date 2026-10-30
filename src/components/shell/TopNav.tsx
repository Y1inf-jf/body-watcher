"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { LogOut } from "lucide-react";
import { NAV_ITEMS, isActive, logout } from "./nav";

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

function fmtToday(d: Date): string {
  return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}`;
}

// 服务端渲染为空串,客户端水合后再出日期,避免 hydration 不一致
function TodayDate() {
  const text = useSyncExternalStore(
    () => () => {},
    () => fmtToday(new Date()),
    () => "",
  );
  return (
    <span className="font-mono text-xs text-ink-3 md:hidden lg:inline">
      {text}
    </span>
  );
}

export default function TopNav() {
  const pathname = usePathname();
  // 登录页不渲染:未登录时导航链接全是死链,点击只会被登录墙弹回
  if (pathname === "/login") return null;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex h-12 max-w-[1200px] items-center gap-4 px-4 md:h-14 md:gap-8 md:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-[2px] bg-ink" />
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ink">
            Body Watcher
          </span>
        </Link>
        <TodayDate />
        <nav aria-label="主导航" className="ml-auto hidden md:flex">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative inline-flex h-14 items-center px-3 text-sm transition-colors ${
                  active
                    ? "text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-ink"
                    : "text-ink-3 hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={logout}
          className="btn btn-ghost btn-sm hidden md:inline-flex"
        >
          <LogOut size={14} strokeWidth={1.8} /> 退出
        </button>
        <button
          type="button"
          onClick={logout}
          aria-label="退出登录"
          className="btn btn-ghost ml-auto h-10 w-10 px-0 md:hidden"
        >
          <LogOut size={16} strokeWidth={1.8} />
        </button>
      </div>
    </header>
  );
}
