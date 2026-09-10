// Google Health 数据同步：拉取 → 解析 → 幂等落库 → 写同步日志。
// 字段结构依据 2026-09 打样验证（docs/google-health-spike.md），呼吸率/血氧字段名官方文档未完全定型，
// 解析做防御式取值，原始 payload 一律存 google_raw_data 兜底。
import {
  finishSyncLog,
  getLastSuccessfulSyncDate,
  insertSyncLog,
  saveGoogleRawData,
  upsertGoogleDailyMetrics,
  type GoogleDailyMetricsInput,
} from "@/lib/db";
import { getValidAccessToken, listGoogleDataPoints, type GoogleDataPoint } from "./auth";
import {
  addExercisePoint,
  dayAvgHr,
  emptyExerciseDay,
  exercisePointDate,
  parseExercisePoint,
  type ExerciseDayAgg,
} from "./exercise-metrics";

type MetricsPartial = Omit<GoogleDailyMetricsInput, "date">;
type MetricsMap = Map<string, MetricsPartial>;

const DAY_MS = 24 * 60 * 60 * 1000;
// 睡眠/运动每页上限 25（官方限制），其余类型单页 10000 足够日级数据。
const SESSION_PAGE_SIZE = 25;

export interface SyncResult {
  status: "success" | "partial" | "error";
  types: Record<string, number>;
  errors: string[];
  startedAt: string;
  finishedAt: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function civilDateStr(d?: { year?: number; month?: number; day?: number }): string | null {
  if (!d?.year || !d?.month || !d?.day) return null;
  return `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;
}

// ISO UTC 时间 + 秒偏移 → 当地日期/HH:mm
function localParts(isoUtc: string, offsetSeconds: number): { date: string; hhmm: string } {
  const d = new Date(new Date(isoUtc).getTime() + offsetSeconds * 1000);
  return { date: d.toISOString().slice(0, 10), hhmm: d.toISOString().slice(11, 16) };
}

function parseOffsetSeconds(v: unknown): number {
  const n = parseInt(String(v ?? "0"), 10);
  return Number.isFinite(n) ? n : 0;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 呼吸率/血氧等类型字段名未完全公开，按候选键名防御式取第一个数值字段。
function pickNumber(obj: Record<string, unknown>, candidates: string[]): number | null {
  for (const key of candidates) {
    const v = num(obj?.[key]);
    if (v !== null) return v;
  }
  return null;
}

function mergeMetrics(map: MetricsMap, date: string, partial: MetricsPartial) {
  const cur = map.get(date) ?? {};
  for (const [k, v] of Object.entries(partial)) {
    if (v !== null && v !== undefined) (cur as Record<string, unknown>)[k] = v;
  }
  map.set(date, cur);
}

function minutesBetween(startIso: string, endIso: string): number {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
}

// 睡眠按醒来日期归属（一晚跨两天）；多次小睡同日则阶段分钟累加、就枕/起床取最早/最晚。
function parseIntoMetrics(map: MetricsMap, rawByDate: Map<string, unknown[]>, points: GoogleDataPoint[]) {
  for (const p of points) {
    const s = p.sleep as
      | {
          interval?: { startTime?: string; endTime?: string; startUtcOffset?: unknown };
          stages?: { startTime?: string; endTime?: string; type?: string }[];
        }
      | undefined;
    if (!s?.interval?.startTime || !s.interval.endTime) continue;
    const offset = parseOffsetSeconds(s.interval.startUtcOffset);
    const bed = localParts(s.interval.startTime, offset);
    const wake = localParts(s.interval.endTime, offset);
    const stages = { deep: 0, rem: 0, light: 0, awake: 0 };
    for (const st of s.stages ?? []) {
      if (!st.startTime || !st.endTime) continue;
      const mins = minutesBetween(st.startTime, st.endTime);
      const key = st.type?.toLowerCase() as keyof typeof stages;
      if (key in stages) stages[key] += Math.max(0, mins);
    }
    // 同日多次会话(夜间睡眠 + 小睡):分钟数累加,就枕/起床取最早/最晚。
    // 每次同步都全量重算最近会话,累加只发生在单次运行内,不会跨同步翻倍。
    const prev = map.get(wake.date);
    mergeMetrics(map, wake.date, {
      sleep_in_bed_minutes: (prev?.sleep_in_bed_minutes ?? 0) + minutesBetween(s.interval.startTime, s.interval.endTime),
      sleep_deep_minutes: (prev?.sleep_deep_minutes ?? 0) + stages.deep,
      sleep_rem_minutes: (prev?.sleep_rem_minutes ?? 0) + stages.rem,
      sleep_light_minutes: (prev?.sleep_light_minutes ?? 0) + stages.light,
      sleep_awake_minutes: (prev?.sleep_awake_minutes ?? 0) + stages.awake,
      sleep_bedtime: !prev?.sleep_bedtime || bed.hhmm < prev.sleep_bedtime ? bed.hhmm : prev.sleep_bedtime,
      sleep_wakeup: !prev?.sleep_wakeup || wake.hhmm > prev.sleep_wakeup ? wake.hhmm : prev.sleep_wakeup,
    });
    pushRaw(rawByDate, "sleep", wake.date, p);
  }
}

function parseStepsIntoMetrics(map: MetricsMap, rawByDate: Map<string, unknown[]>, points: GoogleDataPoint[]) {
  // Google Fit 同时保留多个来源的步数(手环 App + 手机 MobileTrack 各记一份),
  // 直接求和会双计(实测单日 ≈2 倍)。跨来源不叠加:按来源分组求和,
  // 有可穿戴来源(device.displayName 含 Fitbit)时优先取用——手环最贴近真值,
  // 手机计步漏记/误判更多;无可穿戴来源时退回取最大来源(通用回退)。
  const byDate = new Map<string, Map<string, { sum: number; wearable: boolean }>>();
  for (const p of points) {
    const st = p.steps as
      | { interval?: { civilStartTime?: { date?: { year?: number; month?: number; day?: number } } }; count?: unknown }
      | undefined;
    const date = civilDateStr(st?.interval?.civilStartTime?.date);
    if (!date) continue;
    const count = num(st?.count) ?? 0;
    const ds = (p as { dataSource?: { device?: { displayName?: string }; dataStreamId?: string } }).dataSource;
    const src = ds?.dataStreamId || JSON.stringify(ds ?? {});
    const wearable = /fitbit/i.test(ds?.device?.displayName ?? "");
    const perSrc = byDate.get(date) ?? new Map<string, { sum: number; wearable: boolean }>();
    const cur = perSrc.get(src) ?? { sum: 0, wearable };
    cur.sum += count;
    perSrc.set(src, cur);
    byDate.set(date, perSrc);
    pushRaw(rawByDate, "steps", date, p);
  }
  for (const [date, perSrc] of byDate) {
    let wearableSum = 0;
    let maxSum = 0;
    for (const { sum, wearable } of perSrc.values()) {
      maxSum = Math.max(maxSum, sum);
      if (wearable) wearableSum = Math.max(wearableSum, sum);
    }
    const prev = map.get(date);
    mergeMetrics(map, date, { steps: wearableSum > 0 ? wearableSum : maxSum });
  }
}

function parseWeightIntoMetrics(map: MetricsMap, rawByDate: Map<string, unknown[]>, points: GoogleDataPoint[]) {
  // 同日多条取时间最新的一条。
  const latest = new Map<string, { time: string; kg: number; point: GoogleDataPoint }>();
  for (const p of points) {
    const w = p.weight as
      | { sampleTime?: { physicalTime?: string; civilTime?: { date?: { year?: number; month?: number; day?: number } } }; weightGrams?: unknown }
      | undefined;
    const date = civilDateStr(w?.sampleTime?.civilTime?.date);
    const kg = num(w?.weightGrams);
    if (!date || kg === null) continue;
    const time = w?.sampleTime?.physicalTime ?? "";
    const cur = latest.get(date);
    if (!cur || time > cur.time) latest.set(date, { time, kg: kg / 1000, point: p });
  }
  for (const [date, { kg, point }] of latest) {
    mergeMetrics(map, date, { weight_kg: Math.round(kg * 100) / 100 });
    pushRaw(rawByDate, "weight", date, point);
  }
}

// 运动:除次数/时长外,补提手环运动记录的心率汇总(平均心率/四区停留秒数/卡路里),
// 供心率负荷对照(见 docs/training-algorithms.md 心率小节);被动识别的会话没有
// metricsSummary,这些字段保持 null,不当 0。先按日聚合再加权,平均心率才能算对。
function parseExerciseIntoMetrics(map: MetricsMap, rawByDate: Map<string, unknown[]>, points: GoogleDataPoint[]) {
  const byDate = new Map<string, ExerciseDayAgg>();
  for (const p of points) {
    const parsed = parseExercisePoint(p);
    const date = exercisePointDate(p);
    if (!parsed || !date) continue;
    let agg = byDate.get(date);
    if (!agg) {
      agg = emptyExerciseDay();
      byDate.set(date, agg);
    }
    addExercisePoint(agg, parsed);
    pushRaw(rawByDate, "exercise", date, p);
  }
  for (const [date, agg] of byDate) {
    mergeMetrics(map, date, {
      exercise_count: agg.count,
      exercise_minutes: agg.minutes,
      exercise_avg_hr: dayAvgHr(agg),
      exercise_zone_light_s: agg.zone.light || null,
      exercise_zone_moderate_s: agg.zone.moderate || null,
      exercise_zone_vigorous_s: agg.zone.vigorous || null,
      exercise_zone_peak_s: agg.zone.peak || null,
      exercise_calories: agg.caloriesCount > 0 ? Math.round(agg.caloriesSum) : null,
    });
  }
}

interface DailyMetricParse {
  dateKey: (payload: Record<string, unknown>) => string | null;
  fields: (payload: Record<string, unknown>) => MetricsPartial;
  rawKey: string;
  label: string;
}

// HRV / 静息心率 / 呼吸率 / 血氧：每日一个点，按 payload 自带 date 归属。
const DAILY_PARSES: DailyMetricParse[] = [
  {
    rawKey: "daily-heart-rate-variability",
    label: "HRV",
    dateKey: (h) => civilDateStr((h.dailyHeartRateVariability as Record<string, unknown> | undefined)?.date as never),
    fields: (h) => {
      const v = h.dailyHeartRateVariability as Record<string, unknown> | undefined;
      return {
        hrv_avg_ms: num(v?.averageHeartRateVariabilityMilliseconds),
        hrv_rmssd_deep_ms: num(v?.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds),
        hrv_nonrem_hr: num(v?.nonRemHeartRateBeatsPerMinute),
        hrv_entropy: num(v?.entropy),
      };
    },
  },
  {
    rawKey: "daily-resting-heart-rate",
    label: "静息心率",
    dateKey: (h) => civilDateStr((h.dailyRestingHeartRate as Record<string, unknown> | undefined)?.date as never),
    fields: (h) => ({
      resting_hr: num((h.dailyRestingHeartRate as Record<string, unknown> | undefined)?.beatsPerMinute),
    }),
  },
  {
    rawKey: "daily-respiratory-rate",
    label: "呼吸率",
    dateKey: (h) =>
      civilDateStr(
        ((h.dailyRespiratoryRate ?? h.respiratoryRate) as Record<string, unknown> | undefined)?.date as never
      ),
    fields: (h) => {
      const v = (h.dailyRespiratoryRate ?? h.respiratoryRate) as Record<string, unknown> | undefined;
      return {
        respiratory_rate: pickNumber(v ?? {}, [
          "averageRespiratoryRate",
          "respiratoryRate",
          "averageBreathsPerMinute",
          "breathsPerMinute",
          "average",
          "value",
        ]),
      };
    },
  },
  {
    rawKey: "daily-oxygen-saturation",
    label: "血氧",
    dateKey: (h) =>
      civilDateStr(
        ((h.dailyOxygenSaturation ?? h.oxygenSaturation) as Record<string, unknown> | undefined)?.date as never
      ),
    fields: (h) => {
      const v = (h.dailyOxygenSaturation ?? h.oxygenSaturation) as Record<string, unknown> | undefined;
      return {
        spo2_avg: pickNumber(v ?? {}, [
          "averageOxygenSaturationPercentage",
          "averagePercentage",
          "oxygenSaturationPercentage",
          "averageSpo2",
          "spo2",
          "average",
          "value",
        ]),
      };
    },
  },
];

function pushRaw(rawByDate: Map<string, unknown[]>, dataType: string, date: string, point: unknown) {
  const key = `${dataType}|${date}`;
  const arr = rawByDate.get(key);
  if (arr) arr.push(point);
  else rawByDate.set(key, [point]);
}

// 增量窗口：上次成功同步日往前重叠 3 天，兜住迟到/修正的数据；从未同步则回溯 7 天。
function computeSinceDate(): string {
  const last = getLastSuccessfulSyncDate();
  const base = last ? new Date(`${last}T00:00:00`) : new Date(Date.now() - 7 * DAY_MS);
  const d = new Date(base.getTime() - 3 * DAY_MS);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

async function syncAll(): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const logId = insertSyncLog(startedAt);
  const types: Record<string, number> = {};
  const errors: string[] = [];
  let status: SyncResult["status"] = "success";

  try {
    const token = await getValidAccessToken();
    const since = computeSinceDate();
    const metrics: MetricsMap = new Map();
    const rawByDate = new Map<string, unknown[]>();

    // 睡眠：不支持 interval 过滤，直接按最近会话分页拉。
    try {
      const points = await listGoogleDataPoints(token, "sleep", { pageSize: SESSION_PAGE_SIZE, maxPages: 10 });
      parseIntoMetrics(metrics, rawByDate, points);
      types.sleep = points.length;
    } catch (e) {
      errors.push(`睡眠: ${(e as Error).message}`);
    }

    // 运动：支持 civil_start_time 过滤；万一过滤参数不被接受就退回全量拉取。
    try {
      let points: GoogleDataPoint[];
      try {
        points = await listGoogleDataPoints(token, "exercise", {
          pageSize: SESSION_PAGE_SIZE,
          filter: `exercise.interval.civil_start_time >= "${since}"`,
        });
      } catch {
        points = await listGoogleDataPoints(token, "exercise", { pageSize: SESSION_PAGE_SIZE, maxPages: 10 });
      }
      parseExerciseIntoMetrics(metrics, rawByDate, points);
      types.exercise = points.length;
    } catch (e) {
      errors.push(`运动: ${(e as Error).message}`);
    }

    // 步数：分钟级点位，尝试按日期过滤（不支持则退回全量）。
    try {
      let points: GoogleDataPoint[];
      try {
        points = await listGoogleDataPoints(token, "steps", { filter: `steps.interval.civil_start_time >= "${since}"` });
      } catch {
        points = await listGoogleDataPoints(token, "steps", { maxPages: 10 });
      }
      parseStepsIntoMetrics(metrics, rawByDate, points);
      types.steps = points.length;
    } catch (e) {
      errors.push(`步数: ${(e as Error).message}`);
    }

    // 体重 + 每日类（HRV/静息心率/呼吸率/血氧）。
    try {
      const points = await listGoogleDataPoints(token, "weight");
      parseWeightIntoMetrics(metrics, rawByDate, points);
      types.weight = points.length;
    } catch (e) {
      errors.push(`体重: ${(e as Error).message}`);
    }
    for (const parse of DAILY_PARSES) {
      try {
        const points = await listGoogleDataPoints(token, parse.rawKey);
        for (const p of points) {
          const payload = p as Record<string, unknown>;
          const date = parse.dateKey(payload);
          if (!date) continue;
          mergeMetrics(metrics, date, parse.fields(payload));
          pushRaw(rawByDate, parse.rawKey, date, p);
        }
        types[parse.rawKey] = points.length;
      } catch (e) {
        errors.push(`${parse.label}: ${(e as Error).message}`);
      }
    }

    // 落库：原始快照 + 每日汇总，单个事务保证一致性。
    const db = (await import("@/lib/db")).getDb();
    const write = db.transaction(() => {
      for (const [key, points] of rawByDate) {
        const [dataType, date] = key.split("|");
        saveGoogleRawData(dataType, date, points);
      }
      for (const [date, partial] of metrics) upsertGoogleDailyMetrics({ date, ...partial });
    });
    write();

    // 无错误 = 全量成功；有错误但至少拉到了数据 = 部分；一个类型都没拉到 = 失败。
    const fetchedAny = Object.keys(types).length > 0;
    status = errors.length === 0 ? "success" : fetchedAny ? "partial" : "error";
  } catch (err) {
    errors.push((err as Error).message);
    status = "error";
  }

  const finishedAt = new Date().toISOString();
  finishSyncLog(logId, {
    finished_at: finishedAt,
    status,
    message: errors.length ? errors.join("；") : null,
    types_synced: JSON.stringify(types),
  });
  return { status, types, errors, startedAt, finishedAt };
}

let _running: Promise<SyncResult> | null = null;

// 并发护栏：定时器与手动按钮可能同时触发，共享同一次进行中的同步。
export function runSync(): Promise<SyncResult> {
  if (_running) return _running;
  _running = syncAll().finally(() => {
    _running = null;
  });
  return _running;
}
