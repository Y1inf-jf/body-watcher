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
  temp_night_c?: number | null;
  temp_baseline_c?: number | null;
  temp_stddev_30d_c?: number | null;
  steps?: number | null;
  [key: string]: unknown;
}

export interface TrainingLogRow {
  date: string;
  duration?: number | null;
  rpe?: number | null;
  exercises?: {
    exercise_name?: string | null;
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
  baselineMean: number | null; // 基线中心值(中位数;HRV 为 exp(ln 中位数),单位 ms)
  baselineSd: number | null; // 离散度(MAD×1.4826 与下限取大;HRV 为 ln 单位,无量纲)
  zScore: number | null;
  deviationPct: number | null;
  baselineDays: number;
  ready: boolean; // 基线样本 >= 5 天才给 z-score
}

export interface SleepSummary {
  lastNight: {
    date: string | null;
    inBedMinutes: number | null;
    asleepMinutes: number | null; // 实际睡眠 = 在床 − 夜间清醒
    deepMinutes: number | null;
    remMinutes: number | null;
    lightMinutes: number | null;
    awakeMinutes: number | null;
    bedtime: string | null;
    wakeup: string | null;
  };
  avgInBed7d: number | null;
  avgAsleep7d: number | null; // 近 7 晚(不含昨晚)实际睡眠均值,睡眠债基线
  debtMinutes: number | null; // 正值 = 欠觉;按近两晚加权(⅔ 昨晚 + ⅓ 前晚) vs 参照线计算
  debtRefMinutes: number | null; // 债务参照线 = max(近7晚均值, 用户最低目标),null=完全无法参照
  deepSharePct: number | null;
}

// 睡眠三档目标(分钟,null=未设)。定义放这里(算法输入类型),存储层从这儿引。
// min=睡眠债参照线的硬地板;target=今晚建议的地板;ideal=今晚建议的封顶。
export interface SleepTargets {
  minMinutes: number | null;
  targetMinutes: number | null;
  idealMinutes: number | null;
}

export interface RecoveryFeatures {
  dataDays: number;
  dataDate: string | null; // 最新一条设备数据的日期（不一定是今天）
  staleDays: number | null; // dataDate 距今的天数,0 = 已同步到今天
  hrv: BaselineFeature & { source: "rmssd_deep" | "avg" | null };
  restingHr: BaselineFeature & { deviationBpm: number | null };
  respiratoryRate: BaselineFeature;
  spo2Avg: number | null;
  // 睡眠皮肤温度:基线直接用设备给的 30 天中位数,不做二次基线;偏差 = 夜间 − 基线。
  temp: {
    nightC: number | null;
    baselineC: number | null;
    deviationC: number | null;
    stddev30dC: number | null;
  };
  sleep: SleepSummary;
  targets: SleepTargets; // 回显用户目标,供 UI/LLM 说明口径
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

// 主要拖累项:告诉用户分数是被哪一项拉低的(如"静息心率比基线高 3 bpm")。
export interface RecoveryDrag {
  key: "hrv" | "restingHr" | "sleep";
  text: string;
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
  drag: RecoveryDrag | null; // 加权贡献最负且 z ≤ −0.5 的一项
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// MAD×1.4826:正态下与标准差同尺度,但少数极端日(如病中几天)拉不宽它。
function robustSpread(values: number[], center: number): number | null {
  if (values.length < 2) return null;
  return 1.4826 * (median(values.map((v) => Math.abs(v - center))) as number);
}

function round1(n: number | null): number | null {
  return n === null ? null : Math.round(n * 10) / 10;
}

// 本地日历日期（SQLite 的 date('now') 是 UTC,凌晨会错一天,统一用这里的本地口径）。
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function localDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 基线:中位数为中心、MAD 为离散,并设离散下限——样本少或设备给整数(RHR)时,
// 原始标准差可能不到 1 bpm,差 2 bpm 就被当成 −3σ 的"极端异常"。
// log=true 时在 ln 空间计算(HRV 近似对数正态,Plews 等的标准做法),回显仍换回原单位。
function computeBaseline(
  pool: number[],
  todayValue: number | null,
  opts: { minSpread: number; log?: boolean; minSamples?: number }
): BaselineFeature {
  const minSamples = opts.minSamples ?? 5;
  const valid = opts.log ? pool.filter((v) => v > 0) : pool;
  const t = opts.log ? valid.map(Math.log) : valid;
  const center = median(t);
  const rawSpread = center === null ? null : robustSpread(t, center);
  const spread = rawSpread === null ? null : Math.max(rawSpread, opts.minSpread);
  const ready = t.length >= minSamples && center !== null && spread !== null;
  const todayT =
    todayValue === null || (opts.log && todayValue <= 0) ? null : opts.log ? Math.log(todayValue) : todayValue;
  const zScore = ready && todayT !== null ? (todayT - (center as number)) / (spread as number) : null;
  const centerOut = center === null ? null : opts.log ? Math.exp(center) : center;
  const deviationPct =
    ready && todayValue !== null && centerOut ? ((todayValue - centerOut) / centerOut) * 100 : null;
  return {
    value: todayValue,
    baselineMean: round1(centerOut),
    baselineSd: spread === null ? null : opts.log ? Math.round(spread * 1000) / 1000 : round1(spread),
    zScore: zScore === null ? null : Math.round(zScore * 100) / 100,
    deviationPct: deviationPct === null ? null : Math.round(deviationPct * 10) / 10,
    baselineDays: t.length,
    ready,
  };
}

const BASELINE_POOL = 30; // 基线池:除今天外最近 30 个样本
const SPREAD_FLOOR = { restingHr: 2.0, lnHrv: 0.08, respiratoryRate: 0.5 } as const;

export function computeRecoveryFeatures(
  rowsAsc: GoogleMetricRow[],
  opts: { sleepTargets?: Partial<SleepTargets> } = {}
): RecoveryFeatures {
  const targets: SleepTargets = {
    minMinutes: opts.sleepTargets?.minMinutes ?? null,
    targetMinutes: opts.sleepTargets?.targetMinutes ?? null,
    idealMinutes: opts.sleepTargets?.idealMinutes ?? null,
  };
  const today = rowsAsc.length > 0 ? rowsAsc[rowsAsc.length - 1] : null;
  // 基线池:除今天外、最近 30 天样本。
  const pool = rowsAsc.slice(0, -1).slice(-BASELINE_POOL);

  // HRV 用整晚均值（与 Fitbit app 显示一致、样本足方差小），缺了退回深睡期 rMSSD。
  const hrvOf = (r: GoogleMetricRow): number | null =>
    r.hrv_avg_ms ?? r.hrv_rmssd_deep_ms ?? null;
  const hrvSource: "avg" | "rmssd_deep" | null =
    today && today.hrv_avg_ms != null
      ? "avg"
      : today && today.hrv_rmssd_deep_ms != null
        ? "rmssd_deep"
        : null;

  const hrvPool = pool.map(hrvOf).filter((v): v is number => v !== null);
  const hrv = {
    ...computeBaseline(hrvPool, today ? hrvOf(today) : null, { minSpread: SPREAD_FLOOR.lnHrv, log: true }),
    source: hrvSource,
  };

  const rhrPool = pool
    .map((r) => (r.resting_hr == null ? null : Number(r.resting_hr)))
    .filter((v): v is number => v !== null);
  const rhrValue = today?.resting_hr != null ? Number(today.resting_hr) : null;
  const rhrBase = computeBaseline(rhrPool, rhrValue, { minSpread: SPREAD_FLOOR.restingHr });
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
    today?.respiratory_rate != null ? Number(today.respiratory_rate) : null,
    { minSpread: SPREAD_FLOOR.respiratoryRate }
  );
  const spo2Avg = today?.spo2_avg != null ? Number(today.spo2_avg) : null;

  const tempNight = today?.temp_night_c != null ? Number(today.temp_night_c) : null;
  const tempBaseline = today?.temp_baseline_c != null ? Number(today.temp_baseline_c) : null;
  const temp = {
    nightC: tempNight,
    baselineC: tempBaseline,
    deviationC:
      tempNight !== null && tempBaseline !== null
        ? Math.round((tempNight - tempBaseline) * 10) / 10
        : null,
    stddev30dC: today?.temp_stddev_30d_c != null ? Number(today.temp_stddev_30d_c) : null,
  };

  const inBedOf = (r: GoogleMetricRow): number | null =>
    r.sleep_in_bed_minutes == null ? null : Number(r.sleep_in_bed_minutes);
  // 实际睡眠按"在床 − 夜间清醒"计:躺 8 小时醒 1.5 小时不该算睡满 8 小时。
  const asleepOf = (r: GoogleMetricRow): number | null => {
    const inBed = inBedOf(r);
    return inBed === null ? null : inBed - Number(r.sleep_awake_minutes ?? 0);
  };
  const recentInBed = rowsAsc.slice(-8, -1).map(inBedOf).filter((v): v is number => v !== null);
  const recentAsleep = rowsAsc.slice(-8, -1).map(asleepOf).filter((v): v is number => v !== null);
  const avgInBed7d = mean(recentInBed);
  const avgAsleep7d = mean(recentAsleep);
  const lastNightInBed = today ? inBedOf(today) : null;
  const lastNightAsleep = today ? asleepOf(today) : null;
  // 近两晚加权(昨晚 ⅔、前晚 ⅓)计债:连着两晚差睡眠仍会反映出来;
  // 旧口径"取较差一晚"天然低于均值,正常睡眠也总记 10–20 分钟债,把分数系统性往下压。
  const prevNightAsleep = rowsAsc.length >= 2 ? asleepOf(rowsAsc[rowsAsc.length - 2]) : null;
  const blendedAsleep =
    lastNightAsleep === null
      ? prevNightAsleep
      : prevNightAsleep === null
        ? lastNightAsleep
        : (2 * lastNightAsleep + prevNightAsleep) / 3;
  const deep = today?.sleep_deep_minutes != null ? Number(today.sleep_deep_minutes) : null;

  // 债务参照线 = max(近7晚实际睡眠均值, 用户最低目标)。设了 min 目标后:
  // 冷启动(无均值)也能算债;均值被连日差睡眠拉低时,目标线兜底防止"越缺越正常"。
  const debtRef =
    avgAsleep7d === null
      ? targets.minMinutes
      : targets.minMinutes === null
        ? Math.round(avgAsleep7d)
        : Math.max(Math.round(avgAsleep7d), targets.minMinutes);

  const sleep: SleepSummary = {
    lastNight: {
      date: today?.date ?? null,
      inBedMinutes: lastNightInBed,
      asleepMinutes: lastNightAsleep,
      deepMinutes: deep,
      remMinutes: today?.sleep_rem_minutes != null ? Number(today.sleep_rem_minutes) : null,
      lightMinutes: today?.sleep_light_minutes != null ? Number(today.sleep_light_minutes) : null,
      awakeMinutes: today?.sleep_awake_minutes != null ? Number(today.sleep_awake_minutes) : null,
      bedtime: (today?.sleep_bedtime as string | undefined) ?? null,
      wakeup: (today?.sleep_wakeup as string | undefined) ?? null,
    },
    avgInBed7d: round1(avgInBed7d),
    avgAsleep7d: round1(avgAsleep7d),
    debtMinutes:
      debtRef !== null && blendedAsleep !== null
        ? Math.round(debtRef - blendedAsleep)
        : null,
    debtRefMinutes: debtRef,
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

  // 陈旧守卫:同步中断时,最后一条数据可能是几天前的,不能冒充"今天"。
  const dataDate = today?.date ?? null;
  const staleDays =
    dataDate !== null
      ? Math.round(
          (new Date(`${localToday()}T00:00:00`).getTime() - new Date(`${dataDate}T00:00:00`).getTime()) / 86400000
        )
      : null;
  const staleNote =
    staleDays !== null && staleDays > 0 ? `；设备数据截至 ${dataDate}（已 ${staleDays} 天未同步）` : "";

  return {
    dataDays: rowsAsc.length,
    dataDate,
    staleDays,
    hrv,
    restingHr,
    respiratoryRate,
    spo2Avg,
    temp,
    sleep,
    targets,
    steps7dTotal: rowsAsc.length ? steps7dTotal : null,
    note: note + staleNote,
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
// 方法：HRV/静息心率对 30 天鲁棒基线(中位数/MAD,HRV 取对数)取 z-score，睡眠债用固定容忍度换算，
// 加权合成后经标准正态 CDF 映射到 0-100。颜色分档对齐 Whoop：<34 红 / 34-66 黄 / >=67 绿。

const SCORE_WEIGHTS = { hrv: 0.4, restingHr: 0.3, sleep: 0.3 } as const;
const SLEEP_DEBT_UNIT_MIN = 45; // 比近 7 天均值少睡 45 分钟记 1 个 z
const Z_CLAMP = 3; // 单项与综合都夹在 ±3，防止单日异常刷出 0% / 100%
const FLAG_SCORE_CAP = 66; // 有异常旗标时封顶黄色档

function clampZ(v: number): number {
  return Math.max(-Z_CLAMP, Math.min(Z_CLAMP, v));
}

const DRAG_MIN_Z = -0.5; // 偏离不到半个 σ 属日常波动,不点名

function dragText(key: RecoveryDrag["key"], f: RecoveryFeatures): string {
  if (key === "hrv") {
    const pct = f.hrv.deviationPct;
    return pct !== null ? `HRV 低于基线 ${Math.abs(Math.round(pct))}%` : "HRV 低于基线";
  }
  if (key === "restingHr") {
    const d = f.restingHr.deviationBpm;
    return d !== null ? `静息心率比基线高 ${Math.round(d)} bpm` : "静息心率高于基线";
  }
  const debt = f.sleep.debtMinutes;
  return debt !== null ? `睡眠比参照线少 ${debt} 分钟` : "睡眠不足";
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
  // 皮肤温度比个人基线高 ≥1°C 是身体在对抗什么的信号(与 Fitbit/Whoop 的口径一致),
  // 只打旗标压档(封顶黄色),不直接进恢复分公式——样本还少,权重给不出来。
  if (f.temp.deviationC != null && f.temp.deviationC >= 1) {
    flags.push(`皮肤温度偏高（+${f.temp.deviationC}°C）`);
  }

  // 静息心率取负：越高恢复越差。
  const zHrv = f.hrv.zScore === null ? null : clampZ(f.hrv.zScore);
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
    drag: null,
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

  let worst: { key: RecoveryDrag["key"]; contrib: number } | null = null;
  for (const c of available) {
    const contrib = (c.z * c.weight) / weightSum;
    if (c.z <= DRAG_MIN_Z && (worst === null || contrib < worst.contrib)) worst = { key: c.key, contrib };
  }
  base.drag = worst ? { key: worst.key, text: dragText(worst.key, f) } : null;

  let score = Math.round(normalCdf(compositeZ) * 100);
  if (flags.length > 0) score = Math.min(score, FLAG_SCORE_CAP);

  return {
    ...base,
    score,
    zone: score < 34 ? "red" : score < 67 ? "yellow" : "green",
    compositeZ: Math.round(compositeZ * 100) / 100,
  };
}
