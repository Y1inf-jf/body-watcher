// exercise 数据点 → 心率/分区/卡路里字段的纯解析器。
// sync.ts(每日同步)与 scripts/backfill-exercise-hr.ts(历史回填)共用,故不 import 任何项目模块。
//
// 字段结构依据 2026-09-10 实测(Fitbit Air,"健力"会话):
//   exercise.metricsSummary.averageHeartRateBeatsPerMinute: "108"(字符串数字)
//   exercise.metricsSummary.heartRateZoneDurations: { lightTime: "2760s", moderateTime: "0s", ... }
//   exercise.metricsSummary.caloriesKcal: 164
// 这些汇总只有手环运动模式(ACTIVELY_MEASURED)会话才带;被动识别的会话可能缺失,
// 一律回 null/0,不当 0 写库。

export interface ExerciseZoneSeconds {
  light: number;
  moderate: number;
  vigorous: number;
  peak: number;
}

export interface ExercisePointMetrics {
  minutes: number; // activeDuration
  avgHr: number | null; // 会话平均心率;无手环运动记录为 null
  hrDurationSec: number; // 加权平均用时长;avgHr 为 null 时无意义
  zoneSeconds: ExerciseZoneSeconds; // 无分区数据时全 0
  calories: number | null;
}

// 单个 exercise 数据点的指标提取。非 exercise 形状/缺 interval 返回 null。
export function parseExercisePoint(p: unknown): ExercisePointMetrics | null {
  const ex = (p as { exercise?: Record<string, unknown> } | null)?.exercise;
  if (!ex) return null;
  const seconds = parseFloat(String(ex.activeDuration ?? "0")) || 0;
  const summary = (ex.metricsSummary ?? {}) as Record<string, unknown>;

  const avgHrRaw = num(summary.averageHeartRateBeatsPerMinute);
  const avgHr = avgHrRaw !== null && avgHrRaw > 0 ? avgHrRaw : null;

  const zonesRaw = (summary.heartRateZoneDurations ?? null) as Record<string, unknown> | null;
  const zoneSeconds: ExerciseZoneSeconds = zonesRaw
    ? {
        light: secondsOf(zonesRaw.lightTime),
        moderate: secondsOf(zonesRaw.moderateTime),
        vigorous: secondsOf(zonesRaw.vigorousTime),
        peak: secondsOf(zonesRaw.peakTime),
      }
    : { light: 0, moderate: 0, vigorous: 0, peak: 0 };

  return {
    minutes: Math.round((seconds / 60) * 10) / 10,
    avgHr,
    hrDurationSec: avgHr !== null ? seconds : 0,
    zoneSeconds,
    calories: num(summary.caloriesKcal),
  };
}

// 按天聚合的累加器:avgHr 需要按时长加权,calories 缺失的会话不参与求和。
export interface ExerciseDayAgg {
  count: number;
  minutes: number;
  hrSumTimesSec: number; // Σ avgHr×时长
  hrSecTotal: number; // Σ 有心率会话的时长
  zone: ExerciseZoneSeconds;
  caloriesSum: number;
  caloriesCount: number;
}

export function emptyExerciseDay(): ExerciseDayAgg {
  return { count: 0, minutes: 0, hrSumTimesSec: 0, hrSecTotal: 0, zone: { light: 0, moderate: 0, vigorous: 0, peak: 0 }, caloriesSum: 0, caloriesCount: 0 };
}

export function addExercisePoint(agg: ExerciseDayAgg, m: ExercisePointMetrics): void {
  agg.count += 1;
  agg.minutes = Math.round((agg.minutes + m.minutes) * 10) / 10;
  if (m.avgHr !== null) {
    agg.hrSumTimesSec += m.avgHr * m.hrDurationSec;
    agg.hrSecTotal += m.hrDurationSec;
  }
  agg.zone.light += m.zoneSeconds.light;
  agg.zone.moderate += m.zoneSeconds.moderate;
  agg.zone.vigorous += m.zoneSeconds.vigorous;
  agg.zone.peak += m.zoneSeconds.peak;
  if (m.calories !== null) {
    agg.caloriesSum += m.calories;
    agg.caloriesCount += 1;
  }
}

export function dayAvgHr(agg: ExerciseDayAgg): number | null {
  return agg.hrSecTotal > 0 ? Math.round(agg.hrSumTimesSec / agg.hrSecTotal) : null;
}

// exercise 数据点 → 当地日期(回填脚本用;与 sync.ts 的口径一致)。
export function exercisePointDate(p: unknown): string | null {
  const ex = (p as { exercise?: Record<string, unknown> } | null)?.exercise;
  const interval = (ex?.interval ?? {}) as Record<string, unknown>;
  const civil = (interval.civilStartTime ?? null) as { date?: Record<string, number> } | null;
  const d = civil?.date;
  if (d?.year && d?.month && d?.day) {
    return `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;
  }
  const start = interval.startTime;
  if (typeof start === "string" && start) {
    const offset = parseInt(String(interval.startUtcOffset ?? "0"), 10) || 0;
    const shifted = new Date(new Date(start).getTime() + offset * 1000);
    return shifted.toISOString().slice(0, 10);
  }
  return null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// "2760s" → 2760;"0" → 0;其他 → 0。
function secondsOf(v: unknown): number {
  if (typeof v !== "string" && typeof v !== "number") return 0;
  const s = String(v).replace(/s$/, "");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
