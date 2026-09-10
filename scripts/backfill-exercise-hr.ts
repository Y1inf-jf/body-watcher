/**
 * 心率汇总回填脚本(一次性,可幂等重跑)。
 *
 * 背景:exercise 数据点里的 metricsSummary(平均心率/四区停留时长/卡路里)在
 * 2026-09-10 之前的同步解析中被丢弃,但原始 payload 一直兜底存在 google_raw_data。
 * 本脚本把这些点重放一遍,按日聚合后回填 google_daily_metrics 的
 * exercise_avg_hr / exercise_zone_*_s / exercise_calories 列,让历史日期
 * 也能参与心率负荷对照(无需重新请求 Google)。
 *
 * 数据流:
 *   google_raw_data(data_type='exercise') → 逐点 parseExercisePoint → 按日聚合
 *   → UPSERT google_daily_metrics(只写本次新增的心率列,其他列不动)
 *
 * 用法:node --experimental-strip-types scripts/backfill-exercise-hr.ts
 */

import Database from "better-sqlite3";
import path from "path";
import {
  addExercisePoint,
  dayAvgHr,
  emptyExerciseDay,
  exercisePointDate,
  parseExercisePoint,
  type ExerciseDayAgg,
} from "../src/lib/google/exercise-metrics.ts";

const DB_PATH = path.join(process.cwd(), "data", "body-watcher.db");
const db = new Database(DB_PATH);
db.pragma("busy_timeout = 5000");

// 列可能在应用下次启动前还不存在(迁移在应用 init 时跑),脚本自给自足补齐。
const cols = db.prepare("PRAGMA table_info(google_daily_metrics)").all() as { name: string }[];
if (!cols.find((c) => c.name === "exercise_avg_hr")) {
  for (const col of [
    "exercise_avg_hr INTEGER",
    "exercise_zone_light_s INTEGER",
    "exercise_zone_moderate_s INTEGER",
    "exercise_zone_vigorous_s INTEGER",
    "exercise_zone_peak_s INTEGER",
    "exercise_calories INTEGER",
  ]) {
    db.exec(`ALTER TABLE google_daily_metrics ADD COLUMN ${col}`);
  }
  console.log("(已补 google_daily_metrics 心率列)");
}

const rows = db
  .prepare("SELECT data_date, payload FROM google_raw_data WHERE data_type = 'exercise' ORDER BY data_date ASC")
  .all() as { data_date: string; payload: string }[];

if (rows.length === 0) {
  console.log("google_raw_data 里没有 exercise 数据,无事可做。");
  process.exit(0);
}

const byDate = new Map<string, ExerciseDayAgg>();
let pointTotal = 0;
let pointParsed = 0;
for (const row of rows) {
  let points: unknown[];
  try {
    points = JSON.parse(row.payload) as unknown[];
  } catch {
    console.log(`!! ${row.data_date}: payload 不是合法 JSON,跳过`);
    continue;
  }
  for (const p of points) {
    pointTotal += 1;
    const parsed = parseExercisePoint(p);
    const date = exercisePointDate(p);
    if (!parsed || !date) continue;
    pointParsed += 1;
    let agg = byDate.get(date);
    if (!agg) {
      agg = emptyExerciseDay();
      byDate.set(date, agg);
    }
    addExercisePoint(agg, parsed);
  }
}

const upsert = db.prepare(`
  INSERT INTO google_daily_metrics (date, exercise_count, exercise_minutes, exercise_avg_hr,
    exercise_zone_light_s, exercise_zone_moderate_s, exercise_zone_vigorous_s, exercise_zone_peak_s, exercise_calories)
  VALUES (@date, @count, @minutes, @avgHr, @light, @moderate, @vigorous, @peak, @calories)
  ON CONFLICT(date) DO UPDATE SET
    exercise_count = COALESCE(excluded.exercise_count, google_daily_metrics.exercise_count),
    exercise_minutes = COALESCE(excluded.exercise_minutes, google_daily_metrics.exercise_minutes),
    exercise_avg_hr = excluded.exercise_avg_hr,
    exercise_zone_light_s = excluded.exercise_zone_light_s,
    exercise_zone_moderate_s = excluded.exercise_zone_moderate_s,
    exercise_zone_vigorous_s = excluded.exercise_zone_vigorous_s,
    exercise_zone_peak_s = excluded.exercise_zone_peak_s,
    exercise_calories = excluded.exercise_calories
`);

const write = db.transaction(() => {
  for (const [date, agg] of byDate) {
    upsert.run({
      date,
      count: agg.count,
      minutes: agg.minutes,
      avgHr: dayAvgHr(agg),
      light: agg.zone.light || null,
      moderate: agg.zone.moderate || null,
      vigorous: agg.zone.vigorous || null,
      peak: agg.zone.peak || null,
      calories: agg.caloriesCount > 0 ? Math.round(agg.caloriesSum) : null,
    });
  }
});
write();

console.log(`回填完成:${byDate.size} 天 / ${pointParsed}/${pointTotal} 个 exercise 点。`);
console.log("日期        会话  分钟   平均心率  轻/中/剧/峰值(秒)            卡路里");
const zoneLine = (a: ExerciseDayAgg) =>
  `${a.zone.light}/${a.zone.moderate}/${a.zone.vigorous}/${a.zone.peak}`;
for (const [date, agg] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(
    `${date}  ${String(agg.count).padStart(4)}  ${String(agg.minutes).padStart(5)}  ` +
      `${String(dayAvgHr(agg) ?? "—").padStart(6)}  ${zoneLine(agg).padEnd(24)}  ` +
      `${agg.caloriesCount > 0 ? Math.round(agg.caloriesSum) : "—"}`
  );
}
db.close();
