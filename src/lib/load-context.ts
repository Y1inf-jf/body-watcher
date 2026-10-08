// 训练状态的"身体情况"解读层:停训或生病之后,ACWR 的"负荷偏低"是应该的——
// 这时该防的是补量过猛,所以进入回归期,按病前周均给逐周上限(0.6 → 0.8 → 1.0)。
// 纯函数、无副作用;规则见 docs/training-algorithms.md 回归期一节。
import { median, type GoogleMetricRow } from "./recovery";
import type { DailyLoadPoint } from "./training-status";

export type LoadContext =
  | {
      phase: "return";
      reason: "gap" | "illness";
      resumeDate: string | null; // 恢复训练首日;null = 尚未恢复
      week: number; // 回归第几周;0 = 尚未恢复
      weekLoad: number; // 本回归周已练(AU)
      weekCap: number | null; // 本周上限;病前无负荷时为 null
      remaining: number | null;
      note: string;
    }
  | { phase: "normal"; note: null };

const GAP_MIN_DAYS = 7;
const GAP_SEARCH_DAYS = 28; // 空窗结束后 21 天回归期都要能识别到
const ILLNESS_WINDOW_DAYS = 14;
const ILLNESS_MIN_DAYS = 2; // 单日体温/呼吸率异常可能是噪声
const BASE_WINDOW_DAYS = 28;
const RETURN_MAX_DAYS = 21;
const RAMP_FACTORS = [0.6, 0.8, 1.0] as const;
const TEMP_RISE_C = 1.0;
const RR_RISE = 1.0;
const RR_MIN_PRIOR = 5;

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000);
}

// 生病信号日:皮肤温度比设备基线高 ≥1°C(与 recovery 旗标同口径,保留 1 位小数比较),
// 或呼吸率比前 30 天中位数高 ≥1 次/分(前序样本 ≥5 天才判)。
export function illnessSignalDays(rowsAsc: GoogleMetricRow[]): string[] {
  const out: string[] = [];
  rowsAsc.forEach((r, i) => {
    const tempDev =
      r.temp_night_c != null && r.temp_baseline_c != null
        ? Math.round((Number(r.temp_night_c) - Number(r.temp_baseline_c)) * 10) / 10
        : null;
    let rrHigh = false;
    if (r.respiratory_rate != null) {
      const prior = rowsAsc
        .slice(Math.max(0, i - 30), i)
        .map((x) => x.respiratory_rate)
        .filter((v): v is number => v != null)
        .map(Number);
      const m = prior.length >= RR_MIN_PRIOR ? median(prior) : null;
      rrHigh = m !== null && Number(r.respiratory_rate) >= m + RR_RISE;
    }
    if ((tempDev !== null && tempDev >= TEMP_RISE_C) || rrHigh) out.push(r.date);
  });
  return out;
}

// 最近一段连续 ≥7 天零负荷(可仍在持续),要求结束日在近 28 天内、且此前 28 天有训练。
function findRecentGap(series: DailyLoadPoint[], today: string): { start: string; end: string } | null {
  let runEnd = -1;
  for (let i = series.length - 1; i >= 0; i--) {
    const zero = series[i].load === 0;
    if (zero && runEnd === -1) runEnd = i;
    if (runEnd === -1 || (zero && i > 0)) continue;
    const runStart = zero ? i : i + 1;
    if (runEnd - runStart + 1 >= GAP_MIN_DAYS) {
      const end = series[runEnd].date;
      if (daysBetween(end, today) > GAP_SEARCH_DAYS) return null;
      const before = series.slice(Math.max(0, runStart - BASE_WINDOW_DAYS), runStart);
      return before.some((p) => p.load > 0) ? { start: series[runStart].date, end } : null;
    }
    runEnd = -1;
  }
  return null;
}

export function computeLoadContext(
  series: DailyLoadPoint[],
  googleRowsAsc: GoogleMetricRow[],
  today: string
): LoadContext {
  const gap = findRecentGap(series, today);
  const signals = illnessSignalDays(googleRowsAsc).filter(
    (d) => d <= today && daysBetween(d, today) < ILLNESS_WINDOW_DAYS
  );
  const ill = signals.length >= ILLNESS_MIN_DAYS;
  if (!gap && !ill) return { phase: "normal", note: null };

  const reason: "gap" | "illness" = ill ? "illness" : "gap";
  const breakStart = gap ? gap.start : signals[0];
  const ends = [gap?.end, ill ? signals[signals.length - 1] : undefined].filter((d): d is string => !!d);
  const breakEnd = ends.sort()[ends.length - 1];
  const sumLoad = (points: DailyLoadPoint[]) => points.reduce((acc, p) => acc + p.load, 0);

  const baseIdx = series.findIndex((p) => p.date === breakStart);
  const baseWeekly = baseIdx > 0 ? sumLoad(series.slice(Math.max(0, baseIdx - BASE_WINDOW_DAYS), baseIdx)) / 4 : 0;
  const resumeDate = series.find((p) => p.date > breakEnd && p.load > 0)?.date ?? null;

  if (resumeDate !== null) {
    // 粘性退出:一旦某天的近 7 天负荷曾经达到基准周负荷,回归期就此结束,不会因为后面几天没练
    // 又因为那次达标的负荷滚出窗口而"退回"回归期(真实场景:9/19 打球后 9/23 出窗口、9/26 又弹回)。
    const everMetBaseline =
      baseWeekly > 0 &&
      series.some((p) => {
        if (p.date < resumeDate || p.date > today) return false;
        const idx = series.indexOf(p);
        const trailing7 = sumLoad(series.slice(Math.max(0, idx - 6), idx + 1));
        return trailing7 >= baseWeekly;
      });
    if (daysBetween(resumeDate, today) >= RETURN_MAX_DAYS || everMetBaseline) {
      return { phase: "normal", note: null };
    }
  }

  const week = resumeDate === null ? 0 : Math.floor(daysBetween(resumeDate, today) / 7) + 1;
  const factor = RAMP_FACTORS[Math.min(Math.max(week, 1), RAMP_FACTORS.length) - 1];
  const weekCap = baseWeekly > 0 ? Math.round(baseWeekly * factor) : null;
  const weekStart = resumeDate === null ? null : shiftDate(resumeDate, 7 * (week - 1));
  const weekLoad =
    weekStart === null ? 0 : Math.round(sumLoad(series.filter((p) => p.date >= weekStart && p.date <= today)));
  const remaining = weekCap === null ? null : weekCap - weekLoad;
  const label = reason === "illness" ? "病后" : "停训后";

  let note: string;
  if (week === 0) {
    note = `回归期（${label}）：尚未恢复训练${weekCap !== null ? `，首周负荷上限 ${weekCap} AU` : ""}`;
  } else {
    note = `回归期第 ${week} 周（${label}）：本周 ${weekLoad}${weekCap !== null ? ` / 上限 ${weekCap}` : ""} AU`;
    note += remaining !== null && remaining <= 0 ? "，本周回归额度已用完，今天维持量，别再加" : "，循序加量";
  }
  return { phase: "return", reason, resumeDate, week, weekLoad, weekCap, remaining, note };
}
