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
  respiratory_rate?: number | null;
  spo2_avg?: number | null;
  steps?: number | null;
  [key: string]: unknown;
}

export interface TrainingLogRow {
  date: string;
  duration?: number | null;
  rpe?: number | null;
  exercises?: {
    muscle_group?: string | null;
    sets?: number | null;
    reps?: number | null;
    weight?: number | null;
    bodyweight?: number | boolean | null;
    rpe?: number | null;
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
  respiratoryRate: BaselineFeature;
  spo2Avg: number | null;
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

export type RecoveryZone = "red" | "yellow" | "green";

export interface RecoveryScoreComponent {
  z: number | null;
  weight: number; // 基准权重
  weightUsed: number | null; // 归一化后实际权重（该项缺信号时为 null）
}

export interface RecoveryScore {
  score: number | null; // 0-100，50 = 自己的正常水平
  zone: RecoveryZone | null;
  compositeZ: number | null;
  components: {
    hrv: RecoveryScoreComponent;
    restingHr: RecoveryScoreComponent;
    sleep: RecoveryScoreComponent;
  };
  flags: string[]; // SpO2 过低 / 呼吸率异常等旗标
  note: string | null; // 不出分时的原因
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

  const rrPool = pool
    .map((r) => (r.respiratory_rate == null ? null : Number(r.respiratory_rate)))
    .filter((v): v is number => v !== null);
  const respiratoryRate = computeBaseline(
    rrPool,
    today?.respiratory_rate != null ? Number(today.respiratory_rate) : null
  );
  const spo2Avg = today?.spo2_avg != null ? Number(today.spo2_avg) : null;

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
    respiratoryRate,
    spo2Avg,
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

// ---------- 恢复分（0-100，50 = 自己的正常水平） ----------
// 方法：HRV/静息心率对 21 天基线取 z-score，睡眠债用固定容忍度换算，
// 加权合成后经标准正态 CDF 映射到 0-100。颜色分档对齐 Whoop：<34 红 / 34-66 黄 / >=67 绿。

const SCORE_WEIGHTS = { hrv: 0.4, restingHr: 0.3, sleep: 0.3 } as const;
const SLEEP_DEBT_UNIT_MIN = 45; // 比近 7 天均值少睡 45 分钟记 1 个 z
const Z_CLAMP = 3; // 单项与综合都夹在 ±3，防止单日异常刷出 0% / 100%
const FLAG_SCORE_CAP = 66; // 有异常旗标时封顶黄色档

function clampZ(v: number): number {
  return Math.max(-Z_CLAMP, Math.min(Z_CLAMP, v));
}

// Zelen & Severo 的 erf 近似（误差 < 1.5e-7），避免为此引依赖。
export function normalCdf(z: number): number {
  const x = z / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const poly =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
    t;
  const erf = 1 - poly * Math.exp(-x * x);
  return 0.5 * (1 + (x >= 0 ? erf : -erf));
}

export function computeRecoveryScore(f: RecoveryFeatures): RecoveryScore {
  const flags: string[] = [];
  if (f.spo2Avg != null && f.spo2Avg < 90) {
    flags.push(`血氧偏低（${f.spo2Avg}%）`);
  }
  if (f.respiratoryRate.ready && f.respiratoryRate.zScore != null && f.respiratoryRate.zScore > 1) {
    flags.push(`呼吸率高于基线（+${f.respiratoryRate.zScore}σ）`);
  }

  // 静息心率取负：越高恢复越差。
  const zHrv = f.hrv.zScore;
  const zRhr =
    f.restingHr.ready && f.restingHr.zScore != null ? clampZ(-f.restingHr.zScore) : null;
  const zSleep =
    f.sleep.debtMinutes != null ? clampZ(-f.sleep.debtMinutes / SLEEP_DEBT_UNIT_MIN) : null;

  const base: RecoveryScore = {
    score: null,
    zone: null,
    compositeZ: null,
    components: {
      hrv: { z: zHrv, weight: SCORE_WEIGHTS.hrv, weightUsed: null },
      restingHr: { z: zRhr, weight: SCORE_WEIGHTS.restingHr, weightUsed: null },
      sleep: { z: zSleep, weight: SCORE_WEIGHTS.sleep, weightUsed: null },
    },
    flags,
    note: null,
  };

  // HRV 基线是核心信号，样本不足时整体不出分，维持"基线累计中"展示。
  if (!f.hrv.ready) {
    return {
      ...base,
      note: `基线累计中（HRV ${f.hrv.baselineDays} 天样本，满 5 天出分）`,
    };
  }

  const candidates: {
    key: keyof RecoveryScore["components"];
    z: number | null;
    weight: number;
  }[] = [
    { key: "hrv", z: zHrv, weight: SCORE_WEIGHTS.hrv },
    { key: "restingHr", z: zRhr, weight: SCORE_WEIGHTS.restingHr },
    { key: "sleep", z: zSleep, weight: SCORE_WEIGHTS.sleep },
  ];
  const available = candidates.filter((c): c is typeof c & { z: number } => c.z !== null);

  if (available.length === 0) {
    return { ...base, note: "基线已就绪，但今晚缺少可用恢复信号（未佩戴或未同步）" };
  }

  // 今晚某项缺数据时权重归一化，由其余信号分摊。
  const weightSum = available.reduce((acc, c) => acc + c.weight, 0);
  const compositeZ = clampZ(
    available.reduce((acc, c) => acc + (c.z * c.weight) / weightSum, 0)
  );
  for (const c of available) {
    base.components[c.key].weightUsed = Math.round((c.weight / weightSum) * 100) / 100;
  }

  let score = Math.round(normalCdf(compositeZ) * 100);
  if (flags.length > 0) score = Math.min(score, FLAG_SCORE_CAP);

  return {
    ...base,
    score,
    zone: score < 34 ? "red" : score < 67 ? "yellow" : "green",
    compositeZ: Math.round(compositeZ * 100) / 100,
  };
}
