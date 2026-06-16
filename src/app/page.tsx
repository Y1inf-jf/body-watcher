"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import TrendChart from "@/components/TrendChart";
import RecoveryPanel from "@/components/RecoveryPanel";
import PlanCard from "@/components/PlanCard";
import ExerciseProgress from "@/components/ExerciseProgress";
import TrainingCalendar from "@/components/TrainingCalendar";
import StatsPanel from "@/components/StatsPanel";
import WeeklySummary from "@/components/WeeklySummary";

interface DashboardData {
  healthMetrics: Record<string, unknown>[];
  muscleRecovery: { muscle_group: string; last_trained: string; days_since: number; total_volume_7d: number | null }[];
  recentTrainings: Record<string, unknown>[];
  bodyComposition: Record<string, unknown>[];
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loadError, setLoadError] = useState(false);

  // 供「重试」按钮调用：重置错误态并重新请求。
  const fetchData = useCallback(() => {
    setLoadError(false);
    fetch("/api/dashboard")
      .then((r) => {
        if (!r.ok) throw new Error("dashboard request failed");
        return r.json();
      })
      .then(setData)
      .catch(() => setLoadError(true));
  }, []);

  // 首次加载：异步 IIFE 内联 fetch，使 setState 脱离 effect 同步路径。
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/dashboard");
        if (!res.ok) throw new Error("dashboard request failed");
        const json = await res.json();
        setData(json);
      } catch {
        setLoadError(true);
      }
    })();
  }, []);

  if (loadError) {
    return (
      <div className="max-w-5xl space-y-4">
        <h2 className="text-xl font-bold">训练总览</h2>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 text-center">
          <p className="text-zinc-400 mb-3">加载数据失败</p>
          <button
            onClick={fetchData}
            className="inline-block bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm font-medium"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return <div className="text-zinc-500">加载中...</div>;
  }

  const isEmpty = data.healthMetrics.length === 0 && data.recentTrainings.length === 0;

  const healthData = data.healthMetrics.map((m) => ({
    date: (m.date as string).slice(5),
    hrv: m.hrv as number | null,
    resting_hr: m.resting_hr as number | null,
    sleep_hours: m.sleep_hours as number | null,
  }));

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">训练总览</h2>
        <a
          href="/api/export"
          className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-1.5 rounded text-xs"
        >
          导出数据
        </a>
      </div>

      {!isEmpty && <StatsPanel />}

      {isEmpty && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 text-center">
          <p className="text-zinc-400 mb-2">欢迎使用 Body Watcher</p>
          <p className="text-zinc-600 text-sm mb-4">
            开始记录你的健康数据和训练日志，系统会自动分析并生成训练计划。
          </p>
          <Link
            href="/input"
            className="inline-block bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm font-medium"
          >
            开始录入数据
          </Link>
        </div>
      )}

      {!isEmpty && (
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
      )}

      {!isEmpty && <RecoveryPanel data={data.muscleRecovery} />}

      {!isEmpty && (
      <div className="grid grid-cols-2 gap-4">
        <TrainingCalendar />
        <ExerciseProgress />
      </div>
      )}

      {!isEmpty && <WeeklySummary />}

      <div>
        <h3 className="text-sm font-medium text-zinc-400 mb-3">近期训练</h3>
        {data.recentTrainings.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-center">
            <p className="text-zinc-600 text-sm">
              还没有训练记录，
              <Link href="/input" className="text-blue-400 hover:text-blue-300">去录入</Link>
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {data.recentTrainings.map((log) => (
              <PlanCard
                key={log.id as number}
                log={log as unknown as Parameters<typeof PlanCard>[0]["log"]}
                onDeleted={fetchData}
                onEdit={(id) => { window.location.href = `/input?edit=${id}`; }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
