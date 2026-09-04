import type { ReactNode } from "react";

// 发光圆环仪表(SVG):恢复分与 ACWR 共用。
// 描边用 drop-shadow 发光,弧长变化带缓动过渡,首屏加载有"充能"效果。
export default function GaugeRing({
  pct,
  color,
  size = 150,
  strokeWidth = 10,
  children,
}: {
  pct: number | null; // 0-1,null → 空环
  color: string; // hex 描边色
  size?: number;
  strokeWidth?: number;
  children?: ReactNode; // 圆心内容(大数字/标签)
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = pct === null ? 0 : Math.max(0, Math.min(1, pct));

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgb(255 255 255 / 0.07)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          style={{
            transition: "stroke-dashoffset 900ms cubic-bezier(0.22, 1, 0.36, 1)",
            filter: clamped > 0 ? `drop-shadow(0 0 6px ${color}80)` : undefined,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children}
      </div>
    </div>
  );
}
