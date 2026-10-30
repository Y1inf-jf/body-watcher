"use client";

import Section from "./ui/Section";
import Tag from "./ui/Tag";

interface MuscleRecovery {
  muscle_group: string;
  last_trained: string;
  days_since: number;
  total_volume_7d: number | null;
}

interface RecoveryPanelProps {
  data: MuscleRecovery[];
}

function getStatus(daysSince: number): { label: string; bar: string; text: string } {
  if (daysSince >= 3) return { label: "可训练", bar: "bg-zone-green", text: "text-zone-green" };
  if (daysSince >= 2) return { label: "恢复中", bar: "bg-zone-amber", text: "text-zone-amber" };
  return { label: "需休息", bar: "bg-zone-red", text: "text-zone-red" };
}

// 肌群恢复网格:总览页常驻区,一眼看完全身状态。
export default function RecoveryPanel({ data }: RecoveryPanelProps) {
  return (
    <Section
      index="04"
      title="肌群恢复"
      aside={
        <>
          <Tag tone="green">可训练</Tag>
          <Tag tone="amber">恢复中</Tag>
          <Tag tone="red">需休息</Tag>
        </>
      }
    >
      {!data.length ? (
        <p className="text-sm text-ink-3">暂无训练数据</p>
      ) : (
        <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-6">
          {data.map((m) => {
            const status = getStatus(m.days_since);
            const filled = Math.min(m.days_since, 3);
            return (
              <div
                key={m.muscle_group}
                className="bg-bg p-3"
                title={`上次训练 ${m.last_trained}${m.total_volume_7d ? ` · 7天容量 ${m.total_volume_7d}kg` : ""}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-ink">{m.muscle_group}</span>
                  <span className="font-mono text-xs text-ink-3">{m.days_since}天</span>
                </div>
                <div className="mt-2 flex gap-0.5">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className={`h-1 flex-1 rounded-full ${i < filled ? status.bar : "bg-line"}`}
                    />
                  ))}
                </div>
                <p className={`mt-2 text-[11px] ${status.text}`}>{status.label}</p>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
