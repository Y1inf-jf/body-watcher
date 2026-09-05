"use client";

import { Card, CardTitle } from "./ui/Card";

interface MuscleRecovery {
  muscle_group: string;
  last_trained: string;
  days_since: number;
  total_volume_7d: number | null;
}

interface RecoveryPanelProps {
  data: MuscleRecovery[];
}

function getStatus(daysSince: number): { label: string; dot: string; text: string } {
  if (daysSince >= 3) return { label: "可训练", dot: "bg-zone-green", text: "text-zone-green" };
  if (daysSince >= 2) return { label: "恢复中", dot: "bg-zone-amber", text: "text-zone-amber" };
  return { label: "需休息", dot: "bg-zone-red", text: "text-zone-red" };
}

// 肌群恢复一行小片:总览页常驻区,一眼看完全身状态。
export default function RecoveryPanel({ data }: RecoveryPanelProps) {
  return (
    <Card className="animate-fade-up p-4">
      <CardTitle className="mb-3">Muscle Recovery · 肌群恢复</CardTitle>
      {!data.length ? (
        <p className="text-sm text-zinc-600">暂无训练数据</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {data.map((m) => {
            const status = getStatus(m.days_since);
            return (
              <div
                key={m.muscle_group}
                className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5"
                title={`上次训练 ${m.last_trained}${m.total_volume_7d ? ` · 7天容量 ${m.total_volume_7d}kg` : ""}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                <span className="text-xs font-medium text-zinc-200">{m.muscle_group}</span>
                <span className={`text-[10px] ${status.text}`}>{status.label}</span>
                <span className="text-[10px] tabular-nums text-zinc-500">{m.days_since}天前</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
