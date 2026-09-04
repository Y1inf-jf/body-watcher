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

function getStatus(daysSince: number): { label: string; className: string } {
  if (daysSince >= 3)
    return { label: "可训练", className: "border-zone-green/40 bg-zone-green/10 text-zone-green" };
  if (daysSince >= 2)
    return { label: "恢复中", className: "border-zone-amber/40 bg-zone-amber/10 text-zone-amber" };
  return { label: "需休息", className: "border-zone-red/40 bg-zone-red/10 text-zone-red" };
}

export default function RecoveryPanel({ data }: RecoveryPanelProps) {
  return (
    <Card className="animate-fade-up p-4">
      <CardTitle className="mb-3">Muscle Recovery · 肌群恢复状态</CardTitle>
      {!data.length ? (
        <p className="text-sm text-zinc-600">暂无训练数据</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {data.map((m) => {
            const status = getStatus(m.days_since);
            return (
              <div key={m.muscle_group} className="rounded-lg border border-white/5 bg-white/[0.02] p-2 text-center">
                <div className="text-sm font-medium text-zinc-200">{m.muscle_group}</div>
                <div className={`mt-1.5 inline-block rounded-full border px-2 py-0.5 text-[10px] ${status.className}`}>
                  {status.label}
                </div>
                <div className="mt-1 text-[10px] tabular-nums text-zinc-500">{m.days_since} 天前训练</div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
