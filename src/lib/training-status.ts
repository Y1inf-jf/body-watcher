// 训练状态算法:把训练记录压成"每日负荷序列",再用三个经典模型解读当下状态。
// 纯函数、无副作用(与 recovery.ts 同风格),公式出处与适配取舍见 docs/training-algorithms.md。
//
// 负荷单位(AU):load = RPE × 时长(分钟) / 6 —— 即"RPE10 练 1 小时 = 100 AU"。
// 选这个量纲是为了对齐 TrainingPeaks CTL/ATL/TSB 的既有分区经验(+5/-10),
// 直接用 sRPE 原始量纲(400+/次)会让 form 的经验阈值完全失效。
import { localToday, type SleepSummary, type TrainingLogRow } from "./recovery";

// ---------- 每日负荷序列 ----------

export interface DailyLoadPoint {
  date: string;
  load: number; // AU,休息日 = 0
  rpeUsed: number | null;
  estimated: boolean; // RPE 为估计值(会话 RPE 和动作 RPE 都缺)
  sessions: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// 会话 RPE 缺失时的启发式:组数 ×0.25 + 每 30 分钟 +1,夹在 [1,10]、四舍五入到 0.5。
// 例:15 组 / 53 分钟 ≈ 6.5(中高强度),7 组 / 25 分钟 ≈ 3.5(轻)。
export function estimateRpe(totalSets: number, durationMin: number): number {
  const raw = 1 + totalSets * 0.25 + durationMin / 30;
  return Math.round(clamp(raw, 1, 10) * 2) / 2;
}

// 单次训练 → 负荷。RPE 来源优先级:会话 rpe → 动作 rpe 均值(训记镜像)→ 启发式估计。
// 时长缺失时按 组数×3 分钟 估。完全空的记录返回 0。
export function sessionLoadOf(log: TrainingLogRow): {
  load: number;
  rpe: number | null;
  estimated: boolean;
} {
  const exercises = log.exercises ?? [];
  const totalSets = exercises.reduce((acc, e) => acc + Number(e.sets ?? 0), 0);
  let duration = Number(log.duration ?? 0);
  if (duration <= 0 && totalSets > 0) {
    duration = totalSets * 3; // 缺时长按 组数×3分钟 估,只影响负荷量,不影响 estimated 标记
  }
  if (duration <= 0) return { load: 0, rpe: null, estimated: true };

  const exerciseRpes = exercises
    .map((e) => (e.rpe == null ? null : Number(e.rpe)))
    .filter((v): v is number => v !== null && !Number.isNaN(v));
  const sessionRpe =
    log.rpe != null
      ? Number(log.rpe)
      : exerciseRpes.length > 0
        ? exerciseRpes.reduce((a, b) => a + b, 0) / exerciseRpes.length
        : null;

  // estimated 只标记"RPE 是估的"(与 UI/工具的提示文案一致);缺时长按组数估是另一回事,不影响 RPE 真实性。
  const estimated = sessionRpe === null;
  const rpe = sessionRpe ?? estimateRpe(totalSets, duration);
  return { load: Math.round((rpe * duration) / 6), rpe, estimated };
}

// 构建 [today-(days-1), today] 的每日负荷序列(休息日补 0)。logs 不限排序,内部聚合。
export function buildDailyLoadSeries(
  logs: TrainingLogRow[],
  days: number,
  today: string = localToday()
): DailyLoadPoint[] {
  const byDate = new Map<string, { load: number; rpe: number | null; estimated: boolean; sessions: number }>();
  for (const log of logs) {
    const { load, rpe, estimated } = sessionLoadOf(log);
    if (load <= 0) continue;
    const day = byDate.get(log.date);
    if (day) {
      day.load += load;
      day.sessions += 1;
      day.estimated = day.estimated || estimated;
      if (rpe !== null) day.rpe = rpe;
    } else {
      byDate.set(log.date, { load, rpe, estimated, sessions: 1 });
    }
  }

  const series: DailyLoadPoint[] = [];
  const end = new Date(`${today}T00:00:00`);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const datestr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const day = byDate.get(datestr);
    series.push({
      date: datestr,
      load: day ? Math.round(day.load) : 0,
      rpeUsed: day?.rpe ?? null,
      estimated: day?.estimated ?? false,
      sessions: day?.sessions ?? 0,
    });
  }
  return series;
}

// ---------- EWMA(指数加权移动平均) ----------

// λ = 2/(τ+1),τ 为天数;首值用序列首项初始化。
export function ewma(values: number[], lambda: number): number {
  if (values.length === 0) return 0;
  let acc = values[0];
  for (let i = 1; i < values.length; i++) {
    acc = values[i] * lambda + acc * (1 - lambda);
  }
  return acc;
}

// ---------- ACWR 急慢性负荷比(Williams 2017, EWMA 版) ----------

export type AcwrZone = "under" | "optimal" | "high" | "risk";

export interface AcwrResult {
  value: number | null;
  acute: number | null; // 7 天 EWMA 日均负荷
  chronic: number | null; // 28 天 EWMA 日均负荷
  zone: AcwrZone | null;
  note: string | null;
}

const ACWR_MIN_DAYS = 14;

export function computeAcwr(series: DailyLoadPoint[]): AcwrResult {
  const loads = series.map((p) => p.load);
  if (loads.length < ACWR_MIN_DAYS) {
    return {
      value: null,
      acute: null,
      chronic: null,
      zone: null,
      note: `数据累计中(需 ≥${ACWR_MIN_DAYS} 天,当前 ${loads.length} 天)`,
    };
  }
  const acute = ewma(loads, 2 / (7 + 1));
  const chronic = ewma(loads, 2 / (28 + 1));
  if (chronic < 1) {
    return { value: null, acute: round1(acute), chronic: round1(chronic), zone: null, note: "近 28 天几乎没有训练负荷" };
  }
  const value = Math.round((acute / chronic) * 100) / 100;
  const zone: AcwrZone = value < 0.8 ? "under" : value <= 1.3 ? "optimal" : value <= 1.5 ? "high" : "risk";
  return { value, acute: round1(acute), chronic: round1(chronic), zone, note: null };
}

// ---------- Form 体力-疲劳(Banister / CTL-ATL-TSB 体系) ----------

export type FormZone = "fresh" | "neutral" | "fatigued";

export interface FormResult {
  value: number | null; // TSB = fitness - fatigue
  fitness: number | null; // CTL, τ=42d
  fatigue: number | null; // ATL, τ=7d
  zone: FormZone | null;
  note: string | null;
}

const FORM_MIN_DAYS = 21;

export function computeForm(series: DailyLoadPoint[]): FormResult {
  const loads = series.map((p) => p.load);
  if (loads.length < FORM_MIN_DAYS) {
    return {
      value: null,
      fitness: null,
      fatigue: null,
      zone: null,
      note: `数据累计中(需 ≥${FORM_MIN_DAYS} 天,当前 ${loads.length} 天)`,
    };
  }
  const fitness = ewma(loads, 2 / (42 + 1));
  const fatigue = ewma(loads, 2 / (7 + 1));
  const value = Math.round((fitness - fatigue) * 10) / 10;
  const zone: FormZone = value > 5 ? "fresh" : value >= -10 ? "neutral" : "fatigued";
  return {
    value,
    fitness: Math.round(fitness),
    fatigue: Math.round(fatigue),
    zone,
    note: null,
  };
}

// ---------- 单调性与 strain(Foster) ----------

export interface WeeklyLoadResult {
  load7d: number; // 近 7 天总负荷(AU)
  monotony: number | null; // 日均/标准差,无量纲;>2 预警
  strain: number | null; // 周负荷 × 单调性
  monotonyWarning: boolean;
}

export function computeWeeklyLoad(series: DailyLoadPoint[]): WeeklyLoadResult {
  const week = series.slice(-7).map((p) => p.load);
  const load7d = Math.round(week.reduce((a, b) => a + b, 0));
  const mean = week.reduce((a, b) => a + b, 0) / week.length;
  const variance = week.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (week.length - 1);
  const sd = Math.sqrt(variance);

  // 全周负荷几乎相同(.sd→0)时单调性趋于无穷:Foster 场景里这正是最危险的
  // "天天一样",封顶 10 表达"极高"即可。
  const monotony = mean > 0 ? round1(Math.min(mean / Math.max(sd, 0.5), 10)) : null;
  const strain = monotony !== null ? Math.round(load7d * monotony) : null;
  return {
    load7d,
    monotony,
    strain,
    monotonyWarning: monotony !== null && monotony > 2,
  };
}

// ---------- 睡眠需求推荐 ----------

export interface SleepNeedResult {
  minutes: number; // 今晚建议在床时长
  base: number; // 个人近 7 天均值
  debtComponent: number; // 债务补偿部分
  loadComponent: number; // 昨日负荷补偿部分
}

// 今晚该睡多久:个人均值打底,睡眠债按 1/3 偿还(不鼓励一次补爆),
// 昨天练得重再加 20 分钟恢复预算。夹在 [5h, 12h]。
export function computeSleepNeed(sleep: SleepSummary, yesterdayLoad: number): SleepNeedResult | null {
  const base = sleep.avgInBed7d;
  if (base === null) return null;
  const debt = sleep.debtMinutes ?? 0;
  const debtComponent = Math.round(clamp(debt, -90, 180) / 3);
  const loadComponent = yesterdayLoad > 250 ? 20 : yesterdayLoad > 100 ? 10 : 0;
  const minutes = Math.round(clamp(base + debtComponent + loadComponent, 300, 720) / 10) * 10;
  return { minutes, base: Math.round(base), debtComponent, loadComponent };
}

// ---------- 汇总 ----------

export interface TrainingStatus {
  series: DailyLoadPoint[]; // 近 28 天(供迷你图/工具引用)
  yesterdayLoad: number; // 昨日负荷(AU),睡眠需求的输入之一
  acwr: AcwrResult;
  form: FormResult;
  weekly: WeeklyLoadResult;
  estimatedSessions: number; // 用了估计 RPE 的训练日数
  totalSessions: number;
}

// 默认 35 天窗口:28 天慢性池 + 7 天缓冲(EWMA 初值衰减)。
export function computeTrainingStatus(
  logs: TrainingLogRow[],
  opts: { days?: number; today?: string } = {}
): TrainingStatus {
  const days = opts.days ?? 35;
  const full = buildDailyLoadSeries(logs, days, opts.today);
  return {
    series: full.slice(-28),
    yesterdayLoad: full.length >= 2 ? full[full.length - 2].load : 0,
    acwr: computeAcwr(full),
    form: computeForm(full),
    weekly: computeWeeklyLoad(full),
    estimatedSessions: full.filter((p) => p.sessions > 0 && p.estimated).length,
    totalSessions: full.reduce((acc, p) => acc + p.sessions, 0),
  };
}
