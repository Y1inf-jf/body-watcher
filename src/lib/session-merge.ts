// 手环运动会话 → 训练负荷的两处修正(纯函数,规则见 docs/training-algorithms.md 手环会话一节):
// 1. 训记计时常不准(用户确认),同日手动开启的 WORKOUT 时长更可信 → 修正训练时长;
// 2. 训记只记力量训练,打球等运动只在手环里 → 按心率负荷折算后计入。
import type { ExerciseSession } from "./google/exercise-metrics";
import type { TrainingLogRow } from "./recovery";
import { hrLoadAu } from "./training-status";

export interface ExtraActivity {
  date: string;
  minutes: number;
  load: number; // AU,已按 EXTRA_HR_LOAD_FACTOR 折算到 sRPE/6 量纲
  label: string;
}

// 心率四区负荷对有氧/球类约为 sRPE/6 口径的 2 倍(9/19:含轻度区的心率负荷 ≈182 AU,
// ×0.5≈91 AU,对照 RPE7×80分钟/6 ≈ 93 AU,比值约 2.0),折半对齐。
export const EXTRA_HR_LOAD_FACTOR = 0.5;
const COMMUTE_TYPES = new Set(["WALKING", "BIKING"]); // 走路/通勤,不算训练
const MERGE_GAP_MS = 10 * 60 * 1000; // 间隔 ≤10 分钟视为同一场(如热身有氧接比赛)
const EXTRA_MIN_HARD_S = 30 * 60; // 中高强度累计 ≥30 分钟才计入

const TYPE_LABEL: Record<string, string> = {
  SPORT: "球类",
  CARDIO_WORKOUT: "有氧",
  RUNNING: "跑步",
  SWIMMING: "游泳",
  HIKING: "徒步",
};

function isLifting(s: ExerciseSession): boolean {
  return s.exerciseType === "WORKOUT" && s.recordingMethod === "ACTIVELY_MEASURED";
}

// 同日恰好一条训练记录时,时长取 max(训记, 手环 WORKOUT 合计);多条时无法可靠配对,不改。
export function correctDurations(logs: TrainingLogRow[], sessions: ExerciseSession[]): TrainingLogRow[] {
  const workoutMin = new Map<string, number>();
  for (const s of sessions) {
    if (isLifting(s)) workoutMin.set(s.date, (workoutMin.get(s.date) ?? 0) + s.activeMinutes);
  }
  const logsPerDate = new Map<string, number>();
  for (const l of logs) logsPerDate.set(l.date, (logsPerDate.get(l.date) ?? 0) + 1);

  return logs.map((l) => {
    const w = workoutMin.get(l.date);
    if (w === undefined || logsPerDate.get(l.date) !== 1) return l;
    const rounded = Math.round(w);
    if (rounded <= Number(l.duration ?? 0)) return l;
    return { ...l, duration: rounded, durationSource: "wearable" };
  });
}

export function extraActivities(sessions: ExerciseSession[]): ExtraActivity[] {
  const candidates = sessions
    .filter((s) => s.exerciseType !== "WORKOUT" && !COMMUTE_TYPES.has(s.exerciseType))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const groups: ExerciseSession[][] = [];
  for (const s of candidates) {
    const group = groups[groups.length - 1];
    const prev = group?.[group.length - 1];
    if (prev && new Date(s.startTime).getTime() - new Date(prev.endTime).getTime() <= MERGE_GAP_MS) {
      group.push(s);
    } else {
      groups.push([s]);
    }
  }

  const out: ExtraActivity[] = [];
  for (const g of groups) {
    const sum = (k: "zoneLightS" | "zoneModerateS" | "zoneVigorousS" | "zonePeakS" | "activeMinutes") =>
      g.reduce((acc, s) => acc + s[k], 0);
    const hard = sum("zoneModerateS") + sum("zoneVigorousS") + sum("zonePeakS");
    if (hard < EXTRA_MIN_HARD_S) continue;
    const longest = g.reduce((a, b) => (b.activeMinutes > a.activeMinutes ? b : a));
    const load = hrLoadAu(sum("zoneLightS"), sum("zoneModerateS"), sum("zoneVigorousS"), sum("zonePeakS"));
    out.push({
      date: g[0].date,
      minutes: Math.round(sum("activeMinutes")),
      load: Math.round(load * EXTRA_HR_LOAD_FACTOR * 10) / 10,
      label: TYPE_LABEL[longest.exerciseType] ?? "运动",
    });
  }
  return out;
}
