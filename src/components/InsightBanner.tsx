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

const LEVEL_STYLE: Record<InsightView["level"], { box: string; text: string; icon: typeof Lightbulb }> = {
  info: { box: "border-blue-800/50 bg-blue-950/40", text: "text-blue-200", icon: Lightbulb },
  warn: { box: "border-zone-amber/40 bg-zone-amber/10", text: "text-zone-amber", icon: AlertTriangle },
  alert: { box: "border-zone-red/40 bg-zone-red/10", text: "text-zone-red", icon: OctagonAlert },
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
    <div className="space-y-2">
      {insights.map((it) => {
        const s = LEVEL_STYLE[it.level];
        const Icon = s.icon;
        return (
          <div
            key={it.id}
            className={`flex items-start gap-2.5 rounded-lg border p-3 text-sm ${s.box} animate-fade-up`}
          >
            <Icon size={15} className={`mt-0.5 shrink-0 ${s.text}`} />
            <p className="min-w-0 flex-1 leading-relaxed">
              <span className={`font-medium ${s.text}`}>{it.title}</span>
              <span className="text-zinc-400"> · {it.detail}</span>
            </p>
            <button
              onClick={() => onDismiss?.(it.id)}
              className="shrink-0 text-zinc-600 transition-colors hover:text-zinc-300"
              aria-label="知道了,收起这条提醒"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
