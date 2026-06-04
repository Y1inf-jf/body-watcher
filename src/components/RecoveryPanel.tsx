"use client";

interface MuscleRecovery {
  muscle_group: string;
  last_trained: string;
  days_since: number;
  total_volume_7d: number | null;
}

interface RecoveryPanelProps {
  data: MuscleRecovery[];
}

function getStatus(daysSince: number): { label: string; color: string } {
  if (daysSince >= 3) return { label: "可训练", color: "bg-green-600" };
  if (daysSince >= 2) return { label: "恢复中", color: "bg-yellow-600" };
  return { label: "需休息", color: "bg-red-600" };
}

export default function RecoveryPanel({ data }: RecoveryPanelProps) {
  if (!data.length) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-zinc-400 mb-2">肌群恢复状态</h3>
        <p className="text-zinc-600 text-sm">暂无训练数据</p>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-zinc-400 mb-3">肌群恢复状态</h3>
      <div className="grid grid-cols-3 gap-2">
        {data.map((m) => {
          const status = getStatus(m.days_since);
          return (
            <div
              key={m.muscle_group}
              className="border border-zinc-800 rounded p-2 text-center"
            >
              <div className="font-medium text-sm">{m.muscle_group}</div>
              <div className={`inline-block mt-1 px-2 py-0.5 rounded text-xs text-white ${status.color}`}>
                {status.label}
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                {m.days_since} 天前训练
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
