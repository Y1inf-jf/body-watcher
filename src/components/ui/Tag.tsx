import type { ReactNode } from "react";

const TONE = {
  neutral: { dot: "bg-ink-3", text: "text-ink-2" },
  green: { dot: "bg-zone-green", text: "text-zone-green" },
  amber: { dot: "bg-zone-amber", text: "text-zone-amber" },
  red: { dot: "bg-zone-red", text: "text-zone-red" },
  accent: { dot: "bg-accent", text: "text-accent" },
} as const;

// 状态标签:色点 + 同色等宽小字,无边框盒。
export default function Tag({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof TONE;
  children: ReactNode;
}) {
  const t = TONE[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-[11px] ${t.text}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.dot}`} />
      {children}
    </span>
  );
}
