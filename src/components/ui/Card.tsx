import type { CSSProperties, ReactNode } from "react";

// 统一卡片配方(.panel 定义在 globals.css),全站换肤的单点入口。
export function Card({
  children,
  className = "",
  glowColor,
}: {
  children: ReactNode;
  className?: string;
  glowColor?: string; // 传入分区色 hex 时卡片带同色辉光
}) {
  const style = glowColor
    ? ({ "--panel-glow-color": glowColor } as CSSProperties)
    : undefined;
  return (
    <div className={`panel panel-glow ${className}`} style={style}>
      {children}
    </div>
  );
}

// Whoop 式微标签:小号大写、宽字距。
export function CardTitle({
  children,
  right,
  className = "",
}: {
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between ${className}`}>
      <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">
        {children}
      </h3>
      {right}
    </div>
  );
}
