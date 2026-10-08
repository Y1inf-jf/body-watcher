// 每日上下文与"日结"的统一入口。
//
// 背景:总览页(dashboard 路由)、洞察规则(insights)、AI 教练(agent)原本各自拼装
// mergeManualHealth + computeRecoveryFeatures + computeTrainingStatus,靠注释人工维持
// "同口径",窗口天数还各不相同——最容易在改动中悄悄漂移。这里收敛成一份。
//
// 另一层原因:日建议与恢复快照原先只在 /api/dashboard 里写。用户哪天没打开总览页,
// 那天就没有 advice_log / recovery_snapshots 记录——月报(读 recovery_snapshots)出现空洞,
// 建议回填闭环(依赖 daily 记录)也断链。所以把写入抽成 settleDaily,由同步流程与总览页共用。
import {
  getSleepTargets,
  queryExerciseSessions,
  queryGoogleDailyMetricsRange,
  queryHealthMetrics,
  queryTrainingHistoryDetailed,
  upsertDailyAdvice,
  upsertRecoverySnapshot,
  type AdviceRow,
} from "./db";
import {
  computeRecoveryFeatures,
  computeRecoveryScore,
  localToday,
  type GoogleMetricRow,
  type RecoveryFeatures,
  type RecoveryScore,
  type SleepTargets,
  type TrainingLogRow,
} from "./recovery";
import {
  buildDailyLoadSeries,
  computeHrLoadStatus,
  computeSleepNeed,
  computeTrainingStatus,
  hrDailyFromRows,
  hrLoadsByDateFromRows,
  type SleepNeedResult,
  type TrainingStatus,
} from "./training-status";
import { computeReadiness, type Readiness } from "./readiness";
import { latestManualSleepQuality, mergeManualHealth } from "./health-merge";
import { computeLoadContext, type LoadContext } from "./load-context";
import { correctDurations, extraActivities } from "./session-merge";
import type { ExerciseSession } from "./google/exercise-metrics";

export interface DailyContext {
  today: string;
  /** 设备指标(升序,旧→新),心率负荷与趋势图的数据源 */
  googleRows: GoogleMetricRow[];
  /** 手动录入指标(补缺用) */
  healthMetrics: Record<string, unknown>[];
  recoveryFeatures: RecoveryFeatures;
  recoveryScore: RecoveryScore;
  trainingStatus: TrainingStatus;
  sleepNeed: SleepNeedResult | null;
  readiness: Readiness;
  /** 回归期判定(停训/生病后的逐周负荷上限) */
  loadContext: LoadContext;
  /** 最近一次训练日期(DESC 查询取首条),洞察的"停训空窗"规则用 */
  lastSessionDate: string | null;
  /** 原始训练记录(DESC,新→旧)。动作基线、周负荷汇总等要明细的调用方直接复用,不必再查一次 */
  trainingLogs: TrainingLogRow[];
}

// 回归期要看"中断前 28 天 + 中断 + 回归 21 天",训练与会话多取到 63 天。
const LOAD_HISTORY_DAYS = 63;

export interface DailyInputs {
  today: string;
  googleRows: GoogleMetricRow[]; // 升序
  healthMetrics: Record<string, unknown>[];
  logs: TrainingLogRow[]; // DESC(与 queryTrainingHistoryDetailed 一致)
  sessions: ExerciseSession[];
  sleepTargets: SleepTargets;
  hr?: "none" | "summary" | "full";
}

/** 纯函数:给定原始输入算出当天全部派生结果。loadDailyContext 与回放脚本共用。 */
export function deriveDailyContext(inp: DailyInputs): DailyContext {
  const hr = inp.hr ?? "none";
  const merged = mergeManualHealth(inp.googleRows, inp.healthMetrics);
  const recoveryFeatures = computeRecoveryFeatures(merged, { sleepTargets: inp.sleepTargets });
  const recoveryScore = computeRecoveryScore(recoveryFeatures);

  // 训记计时不准时以手环 WORKOUT 时长为准;打球等只在手环里的运动折算后计入。
  const logs = correctDurations(inp.logs, inp.sessions);
  const extras = extraActivities(inp.sessions);
  const trainingStatus = computeTrainingStatus(logs, { today: inp.today, extraActivities: extras });
  if (hr !== "none") {
    trainingStatus.hr = computeHrLoadStatus(hrLoadsByDateFromRows(inp.googleRows), inp.today);
    if (hr === "full") trainingStatus.hr.daily = hrDailyFromRows(inp.googleRows);
  }
  const loadContext = computeLoadContext(
    buildDailyLoadSeries(logs, LOAD_HISTORY_DAYS, inp.today, extras),
    inp.googleRows,
    inp.today
  );

  const sleepNeed = computeSleepNeed(recoveryFeatures.sleep, trainingStatus.yesterdayLoad, inp.sleepTargets);
  const readiness = computeReadiness(trainingStatus, recoveryScore, {
    manualSleepQuality: latestManualSleepQuality(inp.healthMetrics),
    loadContext,
  });

  return {
    today: inp.today,
    googleRows: inp.googleRows,
    healthMetrics: inp.healthMetrics,
    recoveryFeatures,
    recoveryScore,
    trainingStatus,
    sleepNeed,
    readiness,
    loadContext,
    // logs 是 DESC:首条即最近一次训练。
    lastSessionDate: logs.length > 0 ? String(logs[0].date) : null,
    trainingLogs: logs,
  };
}

/**
 * 单一口径入口:一次算出当天全部派生结果。
 *
 * - days 默认 35(28 天慢性池 + 7 天缓冲);恢复侧基线池只取最近 30 个样本,
 *   所以 30 与 35 对恢复分等价,统一到 35 不会改变分数。训练记录与手环会话
 *   至少取 63 天(回归期判定需要),更早的记录不影响 35 天训练状态窗口。
 * - hr 控制心率负荷对照的粒度:"none" 不算(默认,同步落档不需要);
 *   "summary" 只算汇总(教练工具用,带上逐日明细会让 tool payload 过大);
 *   "full" 额外带逐日明细(总览卡展开表用)。
 */
export function loadDailyContext(
  opts: { days?: number; hr?: "none" | "summary" | "full" } = {}
): DailyContext {
  const days = opts.days ?? 35;
  return deriveDailyContext({
    today: localToday(),
    googleRows: queryGoogleDailyMetricsRange(days) as GoogleMetricRow[],
    healthMetrics: queryHealthMetrics(30) as Record<string, unknown>[],
    logs: queryTrainingHistoryDetailed(Math.max(days, LOAD_HISTORY_DAYS)) as TrainingLogRow[],
    sessions: queryExerciseSessions(Math.max(days, LOAD_HISTORY_DAYS)),
    sleepTargets: getSleepTargets(),
    hr: opts.hr,
  });
}

/**
 * 日结:把"今日建议"与"恢复快照"落档。
 *
 * **必须由同步流程(instrumentation)与总览页共同调用**——只挂在总览页上时,
 * 没打开页面的日子不会留下记录,月报趋势会出现空洞、建议回填链会断。
 * 两者都是按日期 upsert,同日重复调用只刷新数值,幂等。
 */
export function settleDaily(ctx: DailyContext): { today: string; advice: AdviceRow } {
  const advice = upsertDailyAdvice(ctx.today, ctx.readiness.headline, ctx.readiness.detail);
  upsertRecoverySnapshot({
    date: ctx.today,
    score: ctx.recoveryScore.score,
    zone: ctx.recoveryScore.zone,
    hrv_z: ctx.recoveryFeatures.hrv.zScore,
    resting_hr_dev: ctx.recoveryFeatures.restingHr.deviationBpm,
    sleep_debt_minutes: ctx.recoveryFeatures.sleep.debtMinutes,
    load_7d: ctx.trainingStatus.weekly.load7d,
    acwr: ctx.trainingStatus.acwr.value,
    form: ctx.trainingStatus.form.value,
  });
  return { today: ctx.today, advice };
}
