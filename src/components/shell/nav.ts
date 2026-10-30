import {
  LayoutDashboard,
  ClipboardList,
  RefreshCw,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  short: string; // 底部 tab bar 用的短标签
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "总览", short: "总览", icon: LayoutDashboard },
  // 数据已全部来自第三方同步(Google Health + 训记),手动录入入口暂时隐藏。
  // 路由 /input 仍保留:计划"执行"按钮的预填流程还在用。
  // { href: "/input", label: "数据录入", icon: PencilLine },
  { href: "/plan", label: "训练计划", short: "计划", icon: ClipboardList },
  { href: "/google", label: "数据同步", short: "同步", icon: RefreshCw },
  { href: "/settings", label: "设置", short: "设置", icon: Settings },
];

export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login";
}
