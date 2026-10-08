/**
 * 恢复分 / 训练状态回放(只读,不入 CI)。
 *
 * 用备份库逐日重算"当天打开总览页会看到什么",对照 recovery_snapshots 里旧算法落档的分数,
 * 用于验收 docs/superpowers/specs/2026-09-24-recovery-load-context-design.md 的成功标准。
 * 手环会话直接从 google_raw_data 解析——老备份里还没有 google_exercise_sessions 表也能跑。
 *
 * 用法:npx -y tsx scripts/replay-recovery.ts <备份库路径> [起始日期] [结束日期]
 *   例:npx -y tsx scripts/replay-recovery.ts D:/SelfInfo/bw-backups/body-watcher-20260924.db 2026-09-04 2026-09-24
 */
import Database from "better-sqlite3";
import { deriveDailyContext } from "../src/lib/daily-context";
import { sessionsFromRawPayloads } from "../src/lib/google/exercise-metrics";
import { shiftDate } from "../src/lib/load-context";
import type { GoogleMetricRow, SleepTargets, TrainingLogRow } from "../src/lib/recovery";

const [dbPath, from = "2026-09-04", to = "2026-09-24"] = process.argv.slice(2);
if (!dbPath) {
  console.error("用法: npx -y tsx scripts/replay-recovery.ts <备份库路径> [起始日期] [结束日期]");
  process.exit(1);
}
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const setting = (key: string): number | null => {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
};
const sleepTargets: SleepTargets = {
  minMinutes: setting("sleep_min_minutes"),
  targetMinutes: setting("sleep_target_minutes"),
  idealMinutes: setting("sleep_ideal_minutes"),
};
const allSessions = sessionsFromRawPayloads(
  (db.prepare("SELECT payload FROM google_raw_data WHERE data_type = 'exercise'").all() as { payload: string }[]).map((r) => r.payload)
);
const snapshot = db.prepare("SELECT score FROM recovery_snapshots WHERE date = ?");

console.log("日期        旧分  新分  拖累项                      今日建议   ACWR  回归期");
for (let day = from; day <= to; day = shiftDate(day, 1)) {
  const googleRows = db
    .prepare("SELECT * FROM google_daily_metrics WHERE date > ? AND date <= ? ORDER BY date ASC")
    .all(shiftDate(day, -35), day) as GoogleMetricRow[];
  const healthMetrics = db
    .prepare("SELECT * FROM daily_health WHERE date > ? AND date <= ? ORDER BY date DESC")
    .all(shiftDate(day, -30), day) as Record<string, unknown>[];
  const logs = db
    .prepare("SELECT * FROM training_log WHERE date > ? AND date <= ? ORDER BY date DESC")
    .all(shiftDate(day, -63), day) as TrainingLogRow[];
  for (const log of logs) {
    log.exercises = db.prepare("SELECT * FROM training_exercise WHERE training_log_id = ?").all(log.id) as TrainingLogRow["exercises"];
  }
  const sessions = allSessions.filter((s) => s.date > shiftDate(day, -63) && s.date <= day);

  const ctx = deriveDailyContext({ today: day, googleRows, healthMetrics, logs, sessions, sleepTargets });
  const old = (snapshot.get(day) as { score: number | null } | undefined)?.score ?? null;
  const lc = ctx.loadContext;
  console.log(
    [
      day,
      String(old ?? "—").padStart(4),
      String(ctx.recoveryScore.score ?? "—").padStart(4),
      (ctx.recoveryScore.drag?.text ?? "").padEnd(24),
      ctx.readiness.headline.padEnd(6),
      String(ctx.trainingStatus.acwr.value ?? "—").padStart(5),
      lc.phase === "return" ? lc.note : "",
    ].join("  ")
  );
}
