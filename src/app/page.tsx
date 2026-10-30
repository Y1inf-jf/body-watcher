"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Activity, Dumbbell, FileText } from "lucide-react";
import TrendChart from "@/components/TrendChart";
import RecoveryPanel from "@/components/RecoveryPanel";
import RecoveryScoreCard from "@/components/RecoveryScoreCard";
import ReadinessCard, { type AdviceView } from "@/components/ReadinessCard";
import InsightBanner, { type InsightView } from "@/components/InsightBanner";
import TrainingStatusCard from "@/components/TrainingStatusCard";
import KeyMetrics from "@/components/KeyMetrics";
import PlanCard from "@/components/PlanCard";
import ExerciseProgress from "@/components/ExerciseProgress";
import TrainingCalendar from "@/components/TrainingCalendar";
import StatsPanel from "@/components/StatsPanel";
import WeeklySummary from "@/components/WeeklySummary";
import MonthlyReview from "@/components/MonthlyReview";
import PageHeader from "@/components/ui/PageHeader";
import Section from "@/components/ui/Section";
import Notice from "@/components/ui/Notice";
import SegmentedTabs, { tabPanelProps } from "@/components/ui/SegmentedTabs";
import { CHART } from "@/components/ui/chart-theme";
import type { RecoveryFeatures, RecoveryScore } from "@/lib/recovery";
import type { Readiness } from "@/lib/readiness";
import type { SleepNeedResult, TrainingStatus } from "@/lib/training-status";
import type { LoadContext } from "@/lib/load-context";

interface DashboardData {
  healthMetrics: Record<string, unknown>[];
  muscleRecovery: { muscle_group: string; last_trained: string; days_since: number; total_volume_7d: number | null }[];
  recentTrainings: Record<string, unknown>[];
  recovery?: { features: RecoveryFeatures; score: RecoveryScore };
  trainingStatus?: TrainingStatus;
  sleepNeed?: SleepNeedResult | null;
  readiness?: Readiness;
  loadContext?: LoadContext;
  today?: string;
  advice?: AdviceView;
  insights?: InsightView[];
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

// 总览页信息分层:今日结论 → 洞察 → 身体/负荷 → 肌群 → 明细(Tab)。
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
      <div className="space-y-4">
        <PageHeader title="训练总览" />
        <Notice tone="err">加载数据失败</Notice>
        <button onClick={fetchData} className="btn btn-secondary">
          重试
        </button>
      </div>
    );
  }

  if (!data) {
    return <p className="py-24 text-center text-sm text-ink-3">加载中…</p>;
  }

  const isEmpty = data.healthMetrics.length === 0 && data.recentTrainings.length === 0;

  // 趋势图:设备指标为主(手动数据在路由层已按日期合并补缺)。
  const healthData = data.chartSeries ?? [];

  return (
    <div>
      <h1 className="sr-only">训练总览</h1>

      {data.recovery && data.trainingStatus && (
        <section
          aria-label="今日"
          className="grid gap-10 border-b border-line pb-10 lg:grid-cols-12 lg:gap-12 lg:pb-12"
        >
          {data.readiness ? (
            <>
              <div className="min-w-0 lg:col-span-7">
                <ReadinessCard
                  readiness={data.readiness}
                  recovery={data.recovery.score}
                  status={data.trainingStatus}
                  advice={data.advice}
                  today={data.today}
                  onAdviceUpdate={(a) => {
                    setData((d) => (d ? { ...d, advice: a } : d));
                    // 回填一条后重拉:有积压时反馈条切到下一条待回填,顺带刷新洞察数字。
                    fetchData();
                  }}
                />
              </div>
              <div className="min-w-0 lg:col-span-5 lg:border-l lg:border-line lg:pl-12">
                <KeyMetrics
                  recovery={data.recovery}
                  status={data.trainingStatus}
                  sleepNeed={data.sleepNeed ?? null}
                />
              </div>
            </>
          ) : (
            <div className="min-w-0 lg:col-span-12">
              <KeyMetrics
                recovery={data.recovery}
                status={data.trainingStatus}
                sleepNeed={data.sleepNeed ?? null}
              />
            </div>
          )}
        </section>
      )}

      {data.insights && data.insights.length > 0 && (
        <section aria-label="洞察提醒" className="border-b border-line py-6">
          <InsightBanner
            insights={data.insights}
            onDismiss={(id) => {
              fetch(`/api/insights?id=${id}`, { method: "DELETE" });
              setData((d) => (d ? { ...d, insights: d.insights?.filter((i) => i.id !== id) } : d));
            }}
          />
        </section>
      )}

      {data.recovery && (
        <div className="grid gap-x-12 gap-y-10 border-b border-line py-10 lg:grid-cols-2">
          <div className="min-w-0">
            <RecoveryScoreCard features={data.recovery.features} score={data.recovery.score} sleepNeed={data.sleepNeed ?? null} />
          </div>
          {data.trainingStatus && (
            <div className="min-w-0">
              <TrainingStatusCard status={data.trainingStatus} loadContext={data.loadContext ?? null} />
            </div>
          )}
        </div>
      )}

      {isEmpty && (
        <div className="py-16 text-center">
          <p className="mb-2 text-ink-2">欢迎使用 Body Watcher</p>
          <p className="mb-6 text-sm text-ink-3">
            开始记录你的健康数据和训练日志，系统会自动分析并生成训练计划。
          </p>
          <Link href="/input" className="btn btn-primary">
            开始录入数据
          </Link>
        </div>
      )}

      {!isEmpty && (
        <div className="border-b border-line py-10">
          <RecoveryPanel data={data.muscleRecovery} />
        </div>
      )}

      {!isEmpty && (
        <Section index="05" title="明细" className="py-10">
          <SegmentedTabs tabs={TABS} value={tab} onChange={setTab} idBase="dash" />

          <div key={tab} {...tabPanelProps("dash", tab)} className="animate-fade-up pt-6">
            {tab === "trend" && (
              <div className="grid grid-cols-1 gap-x-8 gap-y-10 md:grid-cols-3">
                <div className="min-w-0">
                  <TrendChart
                    title="HRV 趋势"
                    unit="ms"
                    data={healthData}
                    series={[{ dataKey: "hrv", color: CHART.series.primary, name: "HRV (ms)" }]}
                  />
                </div>
                <div className="min-w-0">
                  <TrendChart
                    title="静息心率"
                    unit="bpm"
                    data={healthData}
                    series={[{ dataKey: "resting_hr", color: CHART.series.primary, name: "心率 (bpm)" }]}
                  />
                </div>
                <div className="min-w-0">
                  <TrendChart
                    title="睡眠时长"
                    unit="h"
                    data={healthData}
                    series={[
                      { dataKey: "sleep_in_bed", color: CHART.series.muted, name: "在床 (h)" },
                      { dataKey: "sleep_asleep", color: CHART.series.primary, name: "睡着 (h)" },
                    ]}
                  />
                </div>
              </div>
            )}

            {tab === "training" && (
              <div className="space-y-10">
                <StatsPanel />
                <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
                  <div className="min-w-0">
                    <TrainingCalendar />
                  </div>
                  <div className="min-w-0">
                    <ExerciseProgress />
                  </div>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-medium text-ink">近期训练</h3>
                  {data.recentTrainings.length === 0 ? (
                    <p className="py-6 text-sm text-ink-3">
                      还没有训练记录，
                      <Link href="/input" className="text-accent underline-offset-4 hover:underline">去录入</Link>
                    </p>
                  ) : (
                    <div className="divide-y divide-line">
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
              <div className="space-y-10">
                <WeeklySummary />
                <MonthlyReview />
              </div>
            )}
          </div>
        </Section>
      )}

      <footer className="pt-10 text-xs text-ink-3">
        <a href="/api/export" className="underline-offset-4 hover:text-ink hover:underline">
          导出全部数据
        </a>
      </footer>
    </div>
  );
}
