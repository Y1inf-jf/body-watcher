import { NextResponse } from "next/server";
import {
  queryHealthMetrics,
  queryMuscleRecovery,
  getRecentTrainings,
  queryGoogleDailyMetricsRange,
  queryTrainingHistoryDetailed,
  getSleepTargets,
  upsertDailyAdvice,
  getLatestPendingDailyAdviceBefore,
  getActiveInsights,
  upsertRecoverySnapshot,
} from "@/lib/db";
import {
  computeRecoveryFeatures,
  computeRecoveryScore,
  localToday,
  type GoogleMetricRow,
  type TrainingLogRow,
} from "@/lib/recovery";
import { computeTrainingStatus, computeHrLoadStatus, hrLoadsByDateFromRows, hrDailyFromRows, computeSleepNeed } from "@/lib/training-status";
import { computeReadiness } from "@/lib/readiness";
import { mergeManualHealth, latestManualSleepQuality } from "@/lib/health-merge";

export async function GET() {
  const healthMetrics = queryHealthMetrics(30);
  const muscleRecovery = queryMuscleRecovery();
  const recentTrainings = getRecentTrainings(5);

  // 35 天窗口:覆盖 21 天基线池 + 当天(恢复侧)和 ACWR 慢性池(负荷侧),一份查询两处用。
  const googleRows = queryGoogleDailyMetricsRange(35) as GoogleMetricRow[];
  // 手动录入补缺:睡眠差/体感这类信号往往是用户先手动记的,冷启动期(基线未就绪)
  // 靠这些字段也能把恢复侧分档跑起来。口径:同日同字段设备值为 null 时用手动态。
  const mergedRows = mergeManualHealth(googleRows, healthMetrics as Record<string, unknown>[]);
  const sleepTargets = getSleepTargets();
  const recoveryFeatures = computeRecoveryFeatures(mergedRows, { sleepTargets });
  const recoveryScore = computeRecoveryScore(recoveryFeatures);
  const trainingStatus = computeTrainingStatus(queryTrainingHistoryDetailed(35) as TrainingLogRow[]);
  // 心率负荷对照:手环运动记录算出的并行 ACWR,与 RPE 负荷互查;daily 供总览卡展开明细。
  trainingStatus.hr = {
    ...computeHrLoadStatus(hrLoadsByDateFromRows(googleRows)),
    daily: hrDailyFromRows(googleRows),
  };
  const sleepNeed = computeSleepNeed(recoveryFeatures.sleep, trainingStatus.yesterdayLoad, sleepTargets);
  // 今日建议:恢复(扛不扛得住) × 负荷(练没练多)合成一个行动结论。
  const readiness = computeReadiness(trainingStatus, recoveryScore, {
    manualSleepQuality: latestManualSleepQuality(healthMetrics as Record<string, unknown>[]),
  });
  const today = localToday();
  // 建议闭环:日建议落档(同日重算只刷新文案,不动已回填的采纳状态/体感)。
  const todayAdvice = upsertDailyAdvice(today, readiness.headline, readiness.detail);
  // 回填条目标:优先最近一条未回填的往日建议(用户晚上练、隔天早上来补昨天的闭环),
  // 无积压则挂今天这条(晚间来访可当天闭环)。
  const advice = getLatestPendingDailyAdviceBefore(today) ?? todayAdvice;
  // 阶段复盘:每日恢复快照存档(同日重算刷新),供月报看趋势。
  upsertRecoverySnapshot({
    date: today,
    score: recoveryScore.score,
    zone: recoveryScore.zone,
    hrv_z: recoveryFeatures.hrv.zScore,
    resting_hr_dev: recoveryFeatures.restingHr.deviationBpm,
    sleep_debt_minutes: recoveryFeatures.sleep.debtMinutes,
    load_7d: trainingStatus.weekly.load7d,
    acwr: trainingStatus.acwr.value,
    form: trainingStatus.form.value,
  });

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
      hrv: g.hrv_rmssd_deep_ms ?? g.hrv_avg_ms ?? null,
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
  for (const m of healthMetrics as Record<string, unknown>[]) {
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
