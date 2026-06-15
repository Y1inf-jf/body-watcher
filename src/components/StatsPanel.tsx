"use client";

import { useEffect, useState } from "react";

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

  if (error) return <div className="text-red-400 text-sm">{error}</div>;
  if (!stats) return null;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-zinc-400 mb-3">训练统计</h3>
      <div className="grid grid-cols-4 gap-3">
        <div className="border border-zinc-800 rounded p-2 text-center">
          <div className="text-lg font-bold text-zinc-200">{stats.totalSessions}</div>
          <div className="text-xs text-zinc-500">总训练</div>
        </div>
        <div className="border border-zinc-800 rounded p-2 text-center">
          <div className="text-lg font-bold text-blue-400">{stats.monthSessions}</div>
          <div className="text-xs text-zinc-500">本月训练</div>
        </div>
        <div className="border border-zinc-800 rounded p-2 text-center">
          <div className="text-lg font-bold text-zinc-200">{stats.totalVolume.toFixed(0)}</div>
          <div className="text-xs text-zinc-500">总容量 (kg)</div>
        </div>
        <div className="border border-zinc-800 rounded p-2 text-center">
          <div className="text-lg font-bold text-green-400">{stats.monthVolume.toFixed(0)}</div>
          <div className="text-xs text-zinc-500">本月容量 (kg)</div>
        </div>
      </div>
      {stats.topExercises.length > 0 && (
        <div className="mt-3">
          <div className="text-xs text-zinc-500 mb-1">最常练</div>
          <div className="flex gap-2 flex-wrap">
            {stats.topExercises.map((e, i) => (
              <span key={e.exercise_name} className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300">
                <span className="text-zinc-500 mr-1">{i + 1}.</span>
                {e.exercise_name}
                <span className="text-zinc-500 ml-1">({e.count}次)</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
