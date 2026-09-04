// 恢复特征计算：把设备原始指标变成带基线参照的结构化信号。
// 纯函数、无副作用（与 formulas.ts 同风格），供 agent 工具和日后的 Recovery 分算法复用。
// 约定：传入的 metricsRows 按日期升序（旧→新），最后一行视为"今天"。

export interface GoogleMetricRow {
  date: string;
  sleep_in_bed_minutes?: number | null;
  sleep_deep_minutes?: number | null;
  sleep_rem_minutes?: number | null;
  sleep_light_minutes?: number | null;
  sleep_awake_minutes?: number | null;
  hrv_avg_ms?: number | null;
  hrv_rmssd_deep_ms?: number | null;
  resting_hr?: number | null;
  steps?: number | null;
  [key: string]: unknown;
}

export interface TrainingLogRow {
  date: string;
  exercises?: {
    muscle_group?: string | null;
    sets?: number | null;
    reps?: number | null;
    weight?: number | null;
    bodyweight?: number | boolean | null;
  }[];
  [key: string]: unknown;
}

export interface BaselineFeature {
  value: number | null;
  baselineMean: number | null;
  baselineSd: number | null;
  zScore: number | null;
  deviationPct: number | null;
  baselineDays: number;
  ready: boolean; // 基线样本 >= 5 天才给 z-score
}

export interface SleepSummary {
  lastNight: {
    date: string | null;
    inBedMinutes: number | null;
    deepMinutes: number | null;
    remMinutes: number | null;
    lightMinutes: number | null;
    awakeMinutes: number | null;
    bedtime: string | null;
    wakeup: string | null;
  };
  avgInBed7d: number | null;
  debtMinutes: number | null; // 正值 = 比近期均值睡得少
  deepSharePct: number | null;
}

export interface RecoveryFeatures {
  dataDays: number;
  hrv: BaselineFeature & { source: "rmssd_deep" | "avg" | null };
  restingHr: BaselineFeature & { deviationBpm: number | null };
  sleep: SleepSummary;
  steps7dTotal: number | null;
  note: string;
}

export interface TrainingLoadSummary {
  sessions7d: number;
  totalVolume7d: number;
  muscleGroups7d: string[];
  lastSessionDate: string | null;
  daysSinceLastSession: number | null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function sd(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  return Math.sqrt(values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1));
}

function round1(n: number | null): number | null {
  return n === null ? null : Math.round(n * 10) / 10;
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function computeBaseline(
  pool: number[],
  todayValue: number | null,
  minSamples = 5
): Omit<BaselineFeature, never> {
  const m = mean(pool);
  const s = sd(pool);
  const ready = pool.length >= minSamples && m !== null && s !== null && s > 0.001;
  const zScore = ready && todayValue !== null ? (todayValue - m) / (s as number) : null;
  const deviationPct =
    ready && todayValue !== null && m !== 0 ? ((todayValue - m) / m) * 100 : null;
  return {
    value: todayValue,
    baselineMean: round1(m),
    baselineSd: round1(s),
    zScore: zScore === null ? null : Math.round(zScore * 100) / 100,
    deviationPct: deviationPct === null ? null : Math.round(deviationPct * 10) / 10,
    baselineDays: pool.length,
    ready,
  };
}

export function computeRecoveryFeatures(rowsAsc: GoogleMetricRow[]): RecoveryFeatures {
  const today = rowsAsc.length > 0 ? rowsAsc[rowsAsc.length - 1] : null;
  // 基线池：除今天外、最近的 21 天样本。
  const pool = rowsAsc.slice(0, -1).slice(-21);

  // HRV 优先用深睡期 rMSSD（更接近恢复信号），缺了退回全天均值。
  const hrvOf = (r: GoogleMetricRow): number | null =>
    r.hrv_rmssd_deep_ms ?? r.hrv_avg_ms ?? null;
  const hrvSource: "rmssd_deep" | "avg" | null =
    today && today.hrv_rmssd_deep_ms != null
      ? "rmssd_deep"
      : today && today.hrv_avg_ms != null
        ? "avg"
        : null;

  const hrvPool = pool.map(hrvOf).filter((v): v is number => v !== null);
  const hrv = {
    ...computeBaseline(hrvPool, today ? hrvOf(today) : null),
    source: hrvSource,
  };

  const rhrPool = pool
    .map((r) => (r.resting_hr == null ? null : Number(r.resting_hr)))
    .filter((v): v is number => v !== null);
  const rhrValue = today?.resting_hr != null ? Number(today.resting_hr) : null;
  const rhrBase = computeBaseline(rhrPool, rhrValue);
  const restingHr = {
    ...rhrBase,
    deviationBpm:
      rhrBase.ready && rhrValue !== null && rhrBase.baselineMean !== null
        ? Math.round((rhrValue - rhrBase.baselineMean) * 10) / 10
        : null,
  };

  const inBedOf = (r: GoogleMetricRow): number | null =>
    r.sleep_in_bed_minutes == null ? null : Number(r.sleep_in_bed_minutes);
  const recentInBed = rowsAsc.slice(-8, -1).map(inBedOf).filter((v): v is number => v !== null);
  const avgInBed7d = mean(recentInBed);
  const lastNightInBed = today ? inBedOf(today) : null;
  const deep = today?.sleep_deep_minutes != null ? Number(today.sleep_deep_minutes) : null;

  const sleep: SleepSummary = {
    lastNight: {
      date: today?.date ?? null,
      inBedMinutes: lastNightInBed,
      deepMinutes: deep,
      remMinutes: today?.sleep_rem_minutes != null ? Number(today.sleep_rem_minutes) : null,
      lightMinutes: today?.sleep_light_minutes != null ? Number(today.sleep_light_minutes) : null,
      awakeMinutes: today?.sleep_awake_minutes != null ? Number(today.sleep_awake_minutes) : null,
      bedtime: (today?.sleep_bedtime as string | undefined) ?? null,
      wakeup: (today?.sleep_wakeup as string | undefined) ?? null,
    },
    avgInBed7d: round1(avgInBed7d),
    debtMinutes:
      avgInBed7d !== null && lastNightInBed !== null
        ? Math.round(avgInBed7d - lastNightInBed)
        : null,
    deepSharePct:
      deep !== null && lastNightInBed !== null && lastNightInBed > 0
        ? Math.round((deep / lastNightInBed) * 1000) / 10
        : null,
  };

  const steps7dTotal = rowsAsc
    .slice(-7)
    .reduce((acc, r) => acc + (r.steps != null ? Number(r.steps) : 0), 0);

  const baselineDays = hrvPool.length;
  const note =
    baselineDays < 5
      ? `基线累计中（当前 ${baselineDays} 天样本，满 5 天后提供 z-score 对比）`
      : `基线基于最近 ${baselineDays} 天样本`;

  return {
    dataDays: rowsAsc.length,
    hrv,
    restingHr,
    sleep,
    steps7dTotal: rowsAsc.length ? steps7dTotal : null,
    note,
  };
}

export function summarizeTrainingLoad(logs: TrainingLogRow[]): TrainingLoadSummary {
  let totalVolume = 0;
  const muscleGroups = new Set<string>();
  for (const log of logs) {
    for (const ex of log.exercises ?? []) {
      const sets = Number(ex.sets ?? 0);
      const reps = Number(ex.reps ?? 0);
      const weight = Number(ex.weight ?? 0);
      totalVolume += sets * reps * weight;
      if (ex.muscle_group) muscleGroups.add(ex.muscle_group);
    }
  }

  const lastDate = logs.length > 0 ? logs.map((l) => l.date).sort().slice(-1)[0] : null;
  const daysSince =
    lastDate !== null
      ? Math.round(
          (new Date(`${localToday()}T00:00:00`).getTime() -
            new Date(`${lastDate}T00:00:00`).getTime()) /
            86400000
        )
      : null;

  return {
    sessions7d: logs.length,
    totalVolume7d: Math.round(totalVolume),
    muscleGroups7d: [...muscleGroups],
    lastSessionDate: lastDate,
    daysSinceLastSession: daysSince,
  };
}
