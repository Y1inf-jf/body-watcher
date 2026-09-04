"use client";

import { useEffect, useState } from "react";
import { Card, CardTitle } from "./ui/Card";

interface Stats {
  totalSessions: number;
  monthSessions: number;
  totalVolume: number;
  monthVolume: number;
  topExercises: { exercise_name: string; count: number }[];
}

export default function StatsPanel() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => setError("加载统计数据失败"));
  }, []);

  if (error) return <div className="text-zone-red text-sm">{error}</div>;
  if (!stats) return null;

  return (
    <Card className="animate-fade-up p-4">
      <CardTitle className="mb-3">Training Stats · 训练统计</CardTitle>
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2 text-center">
          <div className="font-mono text-lg font-bold tabular-nums text-zinc-100">{stats.totalSessions}</div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">总训练</div>
        </div>
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2 text-center">
          <div className="font-mono text-lg font-bold tabular-nums text-accent">{stats.monthSessions}</div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">本月训练</div>
        </div>
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2 text-center">
          <div className="font-mono text-lg font-bold tabular-nums text-zinc-100">{stats.totalVolume.toFixed(0)}</div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">总容量 (kg)</div>
        </div>
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2 text-center">
          <div className="font-mono text-lg font-bold tabular-nums text-zone-green">{stats.monthVolume.toFixed(0)}</div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">本月容量 (kg)</div>
        </div>
      </div>
      {stats.topExercises.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-zinc-500">最常练</div>
          <div className="flex flex-wrap gap-2">
            {stats.topExercises.map((e, i) => (
              <span
                key={e.exercise_name}
                className="rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-xs text-zinc-300"
              >
                <span className="mr-1 font-mono text-zinc-500">{i + 1}.</span>
                {e.exercise_name}
                <span className="ml-1 font-mono text-zinc-500">({e.count}次)</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
