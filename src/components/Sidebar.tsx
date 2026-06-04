"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "总览" },
  { href: "/input", label: "数据录入" },
  { href: "/plan", label: "训练计划" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="w-48 border-r border-zinc-800 p-4 flex flex-col gap-2">
      <h1 className="text-lg font-bold mb-4 text-zinc-100">Body Watcher</h1>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`px-3 py-2 rounded text-sm transition-colors ${
            pathname === link.href
              ? "bg-zinc-800 text-white"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
          }`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
