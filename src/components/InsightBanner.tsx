"use client";

import { X, Lightbulb, AlertTriangle, OctagonAlert } from "lucide-react";

export interface InsightView {
  id: number;
  rule_id: string;
  date: string;
  level: "info" | "warn" | "alert";
  title: string;
  detail: string;
}

// 级别色只给图标,文字保持中性。
const LEVEL_STYLE: Record<InsightView["level"], { icon: string; Icon: typeof Lightbulb }> = {
  info: { icon: "text-accent", Icon: Lightbulb },
  warn: { icon: "text-zone-amber", Icon: AlertTriangle },
  alert: { icon: "text-zone-red", Icon: OctagonAlert },
};

// 主动洞察横幅:同步后规则引擎产出,数据性提醒(睡眠债/负荷峰值/停训空窗/闭环滞留)。
// 一条一行,可关掉;次日军情仍在会重新出现。
export default function InsightBanner({
  insights,
  onDismiss,
}: {
  insights: InsightView[];
  onDismiss?: (id: number) => void;
}) {
  if (insights.length === 0) return null;
  return (
    <ul className="divide-y divide-line">
      {insights.map((it) => {
        const { icon, Icon } = LEVEL_STYLE[it.level];
        return (
          <li key={it.id} className="animate-fade-up flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <Icon size={16} className={`mt-0.5 shrink-0 ${icon}`} />
            <p className="min-w-0 flex-1 text-sm leading-relaxed">
              <span className="font-medium text-ink">{it.title}</span>
              <span className="text-ink-2"> · {it.detail}</span>
            </p>
            <button
              onClick={() => onDismiss?.(it.id)}
              className="-mr-2 grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
              aria-label="知道了,收起这条提醒"
            >
              <X size={14} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
