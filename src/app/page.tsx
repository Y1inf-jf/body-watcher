"use client";

import { useEffect, useState } from "react";
import TrendChart from "@/components/TrendChart";
import RecoveryPanel from "@/components/RecoveryPanel";
import PlanCard from "@/components/PlanCard";

interface DashboardData {
  healthMetrics: Record<string, unknown>[];
  muscleRecovery: { muscle_group: string; last_trained: string; days_since: number; total_volume_7d: number | null }[];
  recentTrainings: Record<string, unknown>[];
  bodyComposition: Record<string, unknown>[];
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) {
    return <div className="text-zinc-500">加载中...</div>;
  }

  const healthData = data.healthMetrics.map((m) => ({
    date: (m.date as string).slice(5),
    hrv: m.hrv as number | null,
    resting_hr: m.resting_hr as number | null,
    sleep_hours: m.sleep_hours as number | null,
  }));

  return (
    <div className="space-y-6 max-w-5xl">
      <h2 className="text-xl font-bold">训练总览</h2>

      <div className="grid grid-cols-2 gap-4">
        <TrendChart
          title="HRV 趋势"
          data={healthData}
          series={[{ dataKey: "hrv", color: "#22c55e", name: "HRV (ms)" }]}
        />
        <TrendChart
          title="静息心率"
          data={healthData}
          series={[{ dataKey: "resting_hr", color: "#ef4444", name: "心率 (bpm)" }]}
        />
        <TrendChart
          title="睡眠时长"
          data={healthData}
          series={[{ dataKey: "sleep_hours", color: "#8b5cf6", name: "时长 (h)" }]}
        />
        <TrendChart
          title="体重 / 体脂"
          data={data.bodyComposition.map((m) => ({
            date: (m.date as string).slice(5),
            weight: m.weight as number | null,
            body_fat: m.body_fat as number | null,
          }))}
          series={[
            { dataKey: "weight", color: "#f59e0b", name: "体重 (kg)" },
            { dataKey: "body_fat", color: "#06b6d4", name: "体脂 (%)" },
          ]}
        />
      </div>

      <RecoveryPanel data={data.muscleRecovery} />

      <div>
        <h3 className="text-sm font-medium text-zinc-400 mb-3">近期训练</h3>
        <div className="space-y-2">
          {data.recentTrainings.map((log) => (
            <PlanCard key={log.id as number} log={log as unknown as Parameters<typeof PlanCard>[0]["log"]} />
          ))}
        </div>
      </div>
    </div>
  );
}
