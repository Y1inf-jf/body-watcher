"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Activity, Dumbbell, FileText } from "lucide-react";
import TrendChart from "@/components/TrendChart";
import RecoveryPanel from "@/components/RecoveryPanel";
import RecoveryScoreCard from "@/components/RecoveryScoreCard";
import ReadinessCard from "@/components/ReadinessCard";
import TrainingStatusCard from "@/components/TrainingStatusCard";
import PlanCard from "@/components/PlanCard";
import ExerciseProgress from "@/components/ExerciseProgress";
import TrainingCalendar from "@/components/TrainingCalendar";
import StatsPanel from "@/components/StatsPanel";
import WeeklySummary from "@/components/WeeklySummary";
import type { RecoveryFeatures, RecoveryScore } from "@/lib/recovery";
import type { Readiness } from "@/lib/readiness";
import type { SleepNeedResult, TrainingStatus } from "@/lib/training-status";

interface DashboardData {
  healthMetrics: Record<string, unknown>[];
  muscleRecovery: { muscle_group: string; last_trained: string; days_since: number; total_volume_7d: number | null }[];
  recentTrainings: Record<string, unknown>[];
  recovery?: { features: RecoveryFeatures; score: RecoveryScore };
  trainingStatus?: TrainingStatus;
  sleepNeed?: SleepNeedResult | null;
  readiness?: Readiness;
  chartSeries?: {
    date: string;
    hrv: number | null;
    resting_hr: number | null;
    sleep_in_bed: number | null;
    sleep_asleep: number | null;
    weight: number | null;
    body_fat: number | null;
  }[];
}

// 总览页信息分层:恢复/状态/肌群常驻,细节收进 Tab,打开即见"今天练什么"。
const TABS = [
  { key: "trend", label: "趋势", icon: Activity },
  { key: "training", label: "训练", icon: Dumbbell },
  { key: "report", label: "报告", icon: FileText },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<TabKey>("trend");

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
        <div className="panel p-6 text-center">
          <p className="text-zinc-400 mb-3">加载数据失败</p>
          <button
            onClick={fetchData}
            className="inline-block rounded-lg bg-accent/90 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-accent"
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

  // 趋势图:设备指标为主(手动数据在路由层已按日期合并补缺)。
  const healthData = data.chartSeries ?? [];

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">训练总览</h2>
        <a
          href="/api/export"
          className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-1.5 rounded text-xs"
        >
          导出数据
        </a>
      </div>

      {data.readiness && data.recovery && data.trainingStatus && (
        <ReadinessCard readiness={data.readiness} recovery={data.recovery.score} status={data.trainingStatus} />
      )}

      {data.recovery && (
        <div className="grid gap-4 lg:grid-cols-2">
          <RecoveryScoreCard features={data.recovery.features} score={data.recovery.score} sleepNeed={data.sleepNeed ?? null} />
          {data.trainingStatus && <TrainingStatusCard status={data.trainingStatus} />}
        </div>
      )}

      {isEmpty && (
        <div className="panel p-6 text-center">
          <p className="text-zinc-400 mb-2">欢迎使用 Body Watcher</p>
          <p className="text-zinc-600 text-sm mb-4">
            开始记录你的健康数据和训练日志，系统会自动分析并生成训练计划。
          </p>
          <Link
            href="/input"
            className="inline-block rounded-lg bg-accent/90 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-accent"
          >
            开始录入数据
          </Link>
        </div>
      )}

      {!isEmpty && <RecoveryPanel data={data.muscleRecovery} />}

      {!isEmpty && (
        <>
          <div role="tablist" className="flex w-fit gap-1 rounded-lg border border-white/[0.07] bg-[#0f0f12] p-1">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.key)}
                  className={`relative flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors ${
                    active ? "bg-white/[0.08] text-zinc-50" : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
                  )}
                  <Icon size={13} strokeWidth={1.8} />
                  {t.label}
                </button>
              );
            })}
          </div>

          {tab === "trend" && (
            <div key="trend" className="animate-fade-up grid grid-cols-1 gap-4 md:grid-cols-3">
              <TrendChart
                title="HRV 趋势"
                data={healthData}
                series={[{ dataKey: "hrv", color: "#00e08c", name: "HRV (ms)" }]}
              />
              <TrendChart
                title="静息心率"
                data={healthData}
                series={[{ dataKey: "resting_hr", color: "#ff5c5c", name: "心率 (bpm)" }]}
              />
              <TrendChart
                title="睡眠时长"
                data={healthData}
                series={[
                  { dataKey: "sleep_in_bed", color: "#22d3ee", name: "在床 (h)" },
                  { dataKey: "sleep_asleep", color: "#a78bfa", name: "睡着 (h)" },
                ]}
              />
            </div>
          )}

          {tab === "training" && (
            <div key="training" className="animate-fade-up space-y-5">
              <StatsPanel />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <TrainingCalendar />
                <ExerciseProgress />
              </div>
              <div>
                <h3 className="mb-3 text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                  Recent · 近期训练
                </h3>
                {data.recentTrainings.length === 0 ? (
                  <div className="panel p-4 text-center">
                    <p className="text-sm text-zinc-600">
                      还没有训练记录，
                      <Link href="/input" className="text-accent hover:text-accent/80">去录入</Link>
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
          )}

          {tab === "report" && (
            <div key="report" className="animate-fade-up">
              <WeeklySummary />
            </div>
          )}
        </>
      )}
    </div>
  );
}
