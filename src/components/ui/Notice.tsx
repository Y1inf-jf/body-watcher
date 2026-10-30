import type { ReactNode } from "react";

const TONE = {
  ok: { bar: "border-zone-green", text: "text-zone-green" },
  err: { bar: "border-zone-red", text: "text-zone-red" },
  warn: { bar: "border-zone-amber", text: "text-zone-amber" },
  info: { bar: "border-accent", text: "text-ink-2" },
} as const;

// 行内提示:左侧 2px 色条。err 用 alert,其余 status。
export default function Notice({
  tone,
  children,
  className = "",
}: {
  tone: keyof typeof TONE;
  children: ReactNode;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <div
      role={tone === "err" ? "alert" : "status"}
      className={`border-l-2 py-2 pl-3 text-sm ${t.bar} ${t.text} ${className}`}
    >
      {children}
    </div>
  );
}
