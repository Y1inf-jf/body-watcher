import { NextResponse } from "next/server";
import {
  getActiveInsights,
  getLatestPendingDailyAdviceBefore,
  getRecentTrainings,
  queryMuscleRecovery,
} from "@/lib/db";
import { loadDailyContext, settleDaily } from "@/lib/daily-context";

export async function GET() {
  // 单一口径:派生结果由 lib/daily-context.ts 统一计算,与洞察规则、日结、教练工具共用,
  // 避免多处各自拼装导致窗口天数/合并规则漂移。hr:"full" 带上心率逐日明细(总览卡展开表用)。
  const ctx = loadDailyContext({ hr: "full" });
  const {
    today,
    googleRows,
    healthMetrics,
    recoveryFeatures,
    recoveryScore,
    trainingStatus,
    sleepNeed,
    readiness,
  } = ctx;

  const muscleRecovery = queryMuscleRecovery();
  const recentTrainings = getRecentTrainings(5);

  // 日结:日建议落档 + 恢复快照存档。原先只在总览页写,导致没打开页面的日子
  // 在月报里缺快照、建议回填链断裂;现在与同步流程共用同一个 settleDaily。
  const todayAdvice = settleDaily(ctx).advice;
  // 回填条目标:优先最近一条未回填的往日建议(用户晚上练、隔天早上来补昨天的闭环),
  // 无积压则挂今天这条(晚间来访可当天闭环)。
  const advice = getLatestPendingDailyAdviceBefore(today) ?? todayAdvice;

  // 趋势图数据:设备指标为主,手动录入补缺(体脂只有手动来源)。日期升序。
  const byDate = new Map<
    string,
    {
      date: string;
      hrv: number | null;
      resting_hr: number | null;
      sleep_in_bed: number | null;
      sleep_asleep: number | null;
      weight: number | null;
      body_fat: number | null;
    }
  >();
  for (const g of googleRows) {
    byDate.set(g.date, {
      date: g.date.slice(5),
      // 整晚均值口径，与 Fitbit app 显示一致；深睡期 RMSSD 只作缺省兜底。
      hrv: g.hrv_avg_ms ?? g.hrv_rmssd_deep_ms ?? null,
      resting_hr: g.resting_hr ?? null,
      sleep_in_bed: g.sleep_in_bed_minutes != null ? Math.round((g.sleep_in_bed_minutes / 60) * 10) / 10 : null,
      sleep_asleep:
        g.sleep_in_bed_minutes != null
          ? Math.round(((g.sleep_in_bed_minutes - (g.sleep_awake_minutes ?? 0)) / 60) * 10) / 10
          : null,
      weight: g.weight_kg != null ? Number(g.weight_kg) : null,
      body_fat: null,
    });
  }
  for (const m of healthMetrics) {
    const date = String(m.date ?? "");
    if (!date) continue;
    const row = byDate.get(date) ?? {
      date: date.slice(5),
      hrv: null,
      resting_hr: null,
      sleep_in_bed: null,
      sleep_asleep: null,
      weight: null,
      body_fat: null,
    };
    const num = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));
    if (row.hrv === null && num(m.hrv) !== null) row.hrv = num(m.hrv);
    if (row.resting_hr === null && num(m.resting_hr) !== null) row.resting_hr = num(m.resting_hr);
    if (row.sleep_asleep === null && num(m.sleep_hours) !== null) row.sleep_asleep = num(m.sleep_hours);
    if (row.weight === null && num(m.weight) !== null) row.weight = num(m.weight);
    if (row.body_fat === null && num(m.body_fat) !== null) row.body_fat = num(m.body_fat);
    byDate.set(date, row);
  }
  const chartSeries = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({
    healthMetrics,
    muscleRecovery,
    recentTrainings,
    recovery: { features: recoveryFeatures, score: recoveryScore },
    trainingStatus,
    sleepNeed,
    readiness,
    today,
    advice,
    insights: getActiveInsights(),
    chartSeries,
  });
}
