"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ClipboardList, RefreshCw, Settings, LogOut } from "lucide-react";

const links = [
  { href: "/", label: "总览", icon: LayoutDashboard },
  // 数据已全部来自第三方同步(Google Health + 训记),手动录入入口暂时隐藏。
  // 路由 /input 仍保留:计划"执行"按钮的预填流程还在用。
  // { href: "/input", label: "数据录入", icon: PencilLine },
  { href: "/plan", label: "训练计划", icon: ClipboardList },
  { href: "/google", label: "数据同步", icon: RefreshCw },
  { href: "/settings", label: "设置", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  // 登录页只保留品牌区:未登录时导航链接全是死链,点击只会被登录墙弹回
  const isLogin = pathname === "/login";

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <nav className="w-48 shrink-0 border-r border-white/5 p-4 flex flex-col">
      <div className="flex items-center gap-2.5 px-2 mb-8 mt-1">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-50" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
        </span>
        <h1 className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-zinc-100">
          Body Watcher
        </h1>
      </div>
      {!isLogin &&
        links.map((link) => {
          const Icon = link.icon;
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-white/[0.06] text-zinc-50"
                  : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
              )}
              <Icon size={15} strokeWidth={1.8} />
              {link.label}
            </Link>
          );
        })}
      {!isLogin && (
        <div className="mt-auto border-t border-white/5 pt-3">
          <button
            onClick={logout}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-600 transition-colors hover:bg-white/[0.04] hover:text-zone-red"
          >
            <LogOut size={15} strokeWidth={1.8} /> 退出
          </button>
        </div>
      )}
    </nav>
  );
}
