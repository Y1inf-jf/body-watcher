"use client";

import { useEffect, useState } from "react";
import Stat from "./ui/Stat";

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
    <div className="animate-fade-up">
      <h3 className="mb-4 text-sm font-medium text-ink">训练统计</h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <Stat label="总训练" value={stats.totalSessions} />
        <Stat label="本月训练" value={stats.monthSessions} />
        <Stat label="总容量 (kg)" value={stats.totalVolume.toFixed(0)} />
        <Stat label="本月容量 (kg)" value={stats.monthVolume.toFixed(0)} />
      </div>
      {stats.topExercises.length > 0 && (
        <div className="mt-5">
          <div className="mb-1 text-xs text-ink-3">最常练</div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {stats.topExercises.map((e, i) => (
              <li key={e.exercise_name} className="text-ink-2">
                <span className="mr-1 font-mono text-ink-3">{i + 1}</span>
                {e.exercise_name}
                <span className="ml-1 font-mono text-xs text-ink-3">({e.count}次)</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
