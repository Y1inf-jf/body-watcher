import type { ReactNode } from "react";

const SIZE = {
  md: "text-xl",
  lg: "text-3xl",
  xl: "text-[40px] leading-none md:text-5xl",
} as const;

// 标签 + 等宽大数字 + 副注。tone 是文字色类(默认 text-ink)。
export default function Stat({
  label,
  value,
  unit,
  sub,
  tone = "text-ink",
  size = "md",
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  tone?: string;
  size?: "md" | "lg" | "xl";
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-ink-3">{label}</div>
      <div
        className={`mt-1 font-mono font-medium tabular-nums ${SIZE[size]} ${tone}`}
      >
        {value}
        {unit && (
          <span className="ml-1 text-xs font-normal text-ink-3">{unit}</span>
        )}
      </div>
      {sub && <div className="mt-1 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}
