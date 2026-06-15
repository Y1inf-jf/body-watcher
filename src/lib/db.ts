import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "body-watcher.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  createTables(_db);
  migrate(_db);
  return _db;
}

function createTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_health (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      hrv REAL,
      resting_hr REAL,
      systolic INTEGER,
      diastolic INTEGER,
      sleep_hours REAL,
      sleep_quality INTEGER,
      weight REAL,
      body_fat REAL,
      rpe INTEGER,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS training_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      duration INTEGER,
      total_volume REAL,
      rpe INTEGER,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS training_exercise (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      training_log_id INTEGER NOT NULL,
      exercise_name TEXT NOT NULL,
      muscle_group TEXT NOT NULL,
      sets INTEGER,
      reps INTEGER,
      weight REAL,
      bodyweight INTEGER DEFAULT 0,
      rpe INTEGER,
      FOREIGN KEY (training_log_id) REFERENCES training_log(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS training_plan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      plan_date TEXT,
      analysis_summary TEXT,
      recovery_assessment TEXT,
      exercises TEXT,
      advice TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS training_template (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      exercises TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS exercise_library (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      muscle_group TEXT,
      equipment TEXT,
      category TEXT,
      wger_id INTEGER UNIQUE,
      image_url TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_exercise_library_name ON exercise_library(name);
  `);
}

function migrate(db: Database.Database) {
  const cols = db.prepare("PRAGMA table_info(training_exercise)").all() as { name: string }[];
  if (!cols.find((c) => c.name === "bodyweight")) {
    db.exec("ALTER TABLE training_exercise ADD COLUMN bodyweight INTEGER DEFAULT 0");
  }
  if (!cols.find((c) => c.name === "rpe")) {
    db.exec("ALTER TABLE training_exercise ADD COLUMN rpe INTEGER");
  }
  const healthCols = db.prepare("PRAGMA table_info(daily_health)").all() as { name: string }[];
  if (!healthCols.find((c) => c.name === "rest_day")) {
    db.exec("ALTER TABLE daily_health ADD COLUMN rest_day INTEGER DEFAULT 0");
  }
}

// --- Health queries ---

export function upsertHealth(data: {
  date: string;
  hrv?: number;
  resting_hr?: number;
  systolic?: number;
  diastolic?: number;
  sleep_hours?: number;
  sleep_quality?: number;
  weight?: number;
  body_fat?: number;
  rpe?: number;
  notes?: string;
  rest_day?: number;
}) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO daily_health (date, hrv, resting_hr, systolic, diastolic, sleep_hours, sleep_quality, weight, body_fat, rpe, notes, rest_day)
    VALUES (@date, @hrv, @resting_hr, @systolic, @diastolic, @sleep_hours, @sleep_quality, @weight, @body_fat, @rpe, @notes, @rest_day)
    ON CONFLICT(date) DO UPDATE SET
      hrv = COALESCE(excluded.hrv, daily_health.hrv),
      resting_hr = COALESCE(excluded.resting_hr, daily_health.resting_hr),
      systolic = COALESCE(excluded.systolic, daily_health.systolic),
      diastolic = COALESCE(excluded.diastolic, daily_health.diastolic),
      sleep_hours = COALESCE(excluded.sleep_hours, daily_health.sleep_hours),
      sleep_quality = COALESCE(excluded.sleep_quality, daily_health.sleep_quality),
      weight = COALESCE(excluded.weight, daily_health.weight),
      body_fat = COALESCE(excluded.body_fat, daily_health.body_fat),
      rpe = COALESCE(excluded.rpe, daily_health.rpe),
      notes = COALESCE(excluded.notes, daily_health.notes),
      rest_day = COALESCE(excluded.rest_day, daily_health.rest_day)
  `).run(data);
}

export function queryHealthMetrics(days: number) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM daily_health
    WHERE date >= date('now', '-' || ? || ' days')
    ORDER BY date DESC
  `).all(days);
}

export function getLatestHealth() {
  const db = getDb();
  return db.prepare(`SELECT * FROM daily_health ORDER BY date DESC LIMIT 1`).get() as Record<string, unknown> | undefined;
}

// --- Training queries ---

export function insertTrainingLog(data: {
  date: string;
  duration?: number;
  total_volume?: number;
  rpe?: number;
  notes?: string;
}, exercises: {
  exercise_name: string;
  muscle_group: string;
  sets?: number;
  reps?: number;
  weight?: number;
  bodyweight?: boolean;
  rpe?: number;
}[]) {
  const db = getDb();
  const insertLog = db.prepare(`
    INSERT INTO training_log (date, duration, total_volume, rpe, notes)
    VALUES (@date, @duration, @total_volume, @rpe, @notes)
  `);
  const insertExercise = db.prepare(`
    INSERT INTO training_exercise (training_log_id, exercise_name, muscle_group, sets, reps, weight, bodyweight, rpe)
    VALUES (?, @exercise_name, @muscle_group, @sets, @reps, @weight, @bodyweight, @rpe)
  `);

  const transaction = db.transaction(() => {
    const result = insertLog.run(data);
    const logId = result.lastInsertRowid;
    for (const ex of exercises) {
      insertExercise.run(logId, ex);
    }
    return logId;
  });

  return transaction();
}

export function queryTrainingHistory(days: number) {
  const db = getDb();
  return db.prepare(`
    SELECT tl.*, GROUP_CONCAT(
      te.exercise_name || ':' || te.muscle_group || ':' || COALESCE(te.sets,0) || 'x' || COALESCE(te.reps,0) || '@' || COALESCE(te.weight,0),
      ' | '
    ) as exercises
    FROM training_log tl
    LEFT JOIN training_exercise te ON te.training_log_id = tl.id
    WHERE tl.date >= date('now', '-' || ? || ' days')
    GROUP BY tl.id
    ORDER BY tl.date DESC
  `).all(days);
}

export function queryTrainingHistoryDetailed(days: number) {
  const db = getDb();
  const logs = db.prepare(`
    SELECT * FROM training_log
    WHERE date >= date('now', '-' || ? || ' days')
    ORDER BY date DESC
  `).all(days) as Record<string, unknown>[];

  for (const log of logs) {
    const exercises = db.prepare(`
      SELECT * FROM training_exercise WHERE training_log_id = ?
    `).all(log.id);
    (log as Record<string, unknown>).exercises = exercises;
  }
  return logs;
}

// --- Muscle recovery ---

export function queryMuscleRecovery() {
  const db = getDb();
  return db.prepare(`
    SELECT
      te.muscle_group,
      MAX(tl.date) as last_trained,
      CAST(julianday('now') - julianday(MAX(tl.date)) AS INTEGER) as days_since,
      SUM(te.sets * te.reps * te.weight) as total_volume_7d
    FROM training_exercise te
    JOIN training_log tl ON tl.id = te.training_log_id
    WHERE tl.date >= date('now', '-7 days')
    GROUP BY te.muscle_group
    ORDER BY days_since ASC
  `).all();
}

// --- Body composition ---

export function queryBodyComposition(days: number) {
  const db = getDb();
  return db.prepare(`
    SELECT date, weight, body_fat FROM daily_health
    WHERE weight IS NOT NULL AND date >= date('now', '-' || ? || ' days')
    ORDER BY date ASC
  `).all(days);
}

// --- Training plan ---

export function saveTrainingPlan(plan: {
  date: string;
  plan_date?: string;
  analysis_summary: string;
  recovery_assessment: string;
  exercises: string;
  advice: string;
}) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO training_plan (date, plan_date, analysis_summary, recovery_assessment, exercises, advice)
    VALUES (@date, @plan_date, @analysis_summary, @recovery_assessment, @exercises, @advice)
  `).run(plan);
}

export function getTrainingPlans(limit: number = 20) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM training_plan ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}

// --- Recent training for dashboard ---

// --- Exercise history ---

export function queryExerciseNames() {
  const db = getDb();
  return db.prepare(`
    SELECT exercise_name, muscle_group, MAX(tl.date) as last_date
    FROM training_exercise te
    JOIN training_log tl ON tl.id = te.training_log_id
    GROUP BY exercise_name
    ORDER BY last_date DESC
  `).all();
}

export function queryLastExerciseSession(exerciseName: string) {
  const db = getDb();
  const logId = db.prepare(`
    SELECT tl.id
    FROM training_log tl
    JOIN training_exercise te ON te.training_log_id = tl.id
    WHERE te.exercise_name = ?
    ORDER BY tl.date DESC
    LIMIT 1
  `).get(exerciseName) as { id: number } | undefined;

  if (!logId) return [];

  return db.prepare(`
    SELECT reps, weight, bodyweight, rpe
    FROM training_exercise
    WHERE training_log_id = ? AND exercise_name = ?
    ORDER BY id ASC
  `).all(logId.id, exerciseName);
}

export function queryExerciseProgress(exerciseName: string, days: number = 90) {
  const db = getDb();
  // 只返回原始 max_weight + max_weight_reps，1RM 由前端按选定公式本地重算。
  return db.prepare(`
    SELECT
      tl.date,
      MAX(CASE WHEN te.bodyweight = 0 THEN te.weight END) as max_weight,
      MAX(CASE WHEN te.bodyweight = 0 THEN te.reps END) as max_weight_reps
    FROM training_exercise te
    JOIN training_log tl ON tl.id = te.training_log_id
    WHERE te.exercise_name = ?
      AND tl.date >= date('now', '-' || ? || ' days')
      AND te.reps IS NOT NULL
    GROUP BY tl.date
    ORDER BY tl.date ASC
  `).all(exerciseName, days);
}

// --- Exercise library (wger cached) ---

export interface ExerciseLibraryEntry {
  id: number;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
  category: string | null;
  wger_id: number | null;
  image_url: string | null;
}

export function searchExerciseLibrary(query: string, limit: number = 10): ExerciseLibraryEntry[] {
  const db = getDb();
  const trimmed = query.trim();
  if (!trimmed) return [];
  // 转义 LIKE 通配符（% _ \），用反斜杠作 ESCAPE 字符，避免用户输入的这些字符被当通配符匹配。
  const escaped = trimmed.replace(/[%_\\]/g, (m) => `\\${m}`);
  const term = `%${escaped}%`;
  return db.prepare(`
    SELECT id, name, muscle_group, equipment, category, wger_id, image_url
    FROM exercise_library
    WHERE name LIKE ? ESCAPE '\\'
    ORDER BY name COLLATE NOCASE ASC
    LIMIT ?
  `).all(term, limit) as ExerciseLibraryEntry[];
}

export function getLibraryCount(): number {
  const db = getDb();
  return (db.prepare("SELECT COUNT(*) as n FROM exercise_library").get() as { n: number }).n;
}

export function insertExerciseLibraryEntry(entry: {
  name: string;
  muscle_group?: string | null;
  equipment?: string | null;
  category?: string | null;
  wger_id?: number | null;
  image_url?: string | null;
}) {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO exercise_library (name, muscle_group, equipment, category, wger_id, image_url)
    VALUES (@name, @muscle_group, @equipment, @category, @wger_id, @image_url)
  `).run({
    muscle_group: null,
    equipment: null,
    category: null,
    wger_id: null,
    image_url: null,
    ...entry,
  });
}

export function queryTrainingCalendar(year: number, month: number) {
  const db = getDb();
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;

  return db.prepare(`
    SELECT tl.id as log_id, tl.date, GROUP_CONCAT(DISTINCT te.muscle_group) as muscle_groups, COUNT(DISTINCT te.exercise_name) as exercise_count
    FROM training_log tl
    JOIN training_exercise te ON te.training_log_id = tl.id
    WHERE tl.date >= ? AND tl.date < ?
    GROUP BY tl.date
    ORDER BY tl.date ASC
  `).all(startDate, endDate);
}

export function getTrainingLog(id: number) {
  const db = getDb();
  const log = db.prepare("SELECT * FROM training_log WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!log) return null;
  (log as Record<string, unknown>).exercises = db.prepare("SELECT * FROM training_exercise WHERE training_log_id = ?").all(id);
  return log;
}

export function deleteTrainingLog(id: number) {
  const db = getDb();
  db.prepare("DELETE FROM training_log WHERE id = ?").run(id);
}

export function updateTrainingLog(
  id: number,
  data: { date: string; duration?: number; total_volume?: number; rpe?: number; notes?: string },
  exercises: { exercise_name: string; muscle_group: string; sets?: number; reps?: number; weight?: number; bodyweight?: boolean; rpe?: number }[]
) {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE training_log SET date = @date, duration = @duration, total_volume = @total_volume, rpe = @rpe, notes = @notes
      WHERE id = ?
    `).run(data, id);
    db.prepare("DELETE FROM training_exercise WHERE training_log_id = ?").run(id);
    const insert = db.prepare(`
      INSERT INTO training_exercise (training_log_id, exercise_name, muscle_group, sets, reps, weight, bodyweight, rpe)
      VALUES (?, @exercise_name, @muscle_group, @sets, @reps, @weight, @bodyweight, @rpe)
    `);
    for (const ex of exercises) insert.run(id, ex);
  });
  tx();
}

export function getRecentTrainings(limit: number = 5) {
  const db = getDb();
  const logs = db.prepare(`
    SELECT * FROM training_log ORDER BY date DESC LIMIT ?
  `).all(limit) as Record<string, unknown>[];

  for (const log of logs) {
    const exercises = db.prepare(`
      SELECT * FROM training_exercise WHERE training_log_id = ?
    `).all(log.id);
    (log as Record<string, unknown>).exercises = exercises;
  }
  return logs;
}

// --- Template queries ---

export function getTemplates() {
  const db = getDb();
  return db.prepare("SELECT * FROM training_template ORDER BY created_at DESC").all();
}

export function saveTemplate(data: { name: string; exercises: string }) {
  const db = getDb();
  return db.prepare("INSERT INTO training_template (name, exercises) VALUES (@name, @exercises)").run(data);
}

export function deleteTemplate(id: number) {
  const db = getDb();
  db.prepare("DELETE FROM training_template WHERE id = ?").run(id);
}

// --- Stats ---

export function queryTrainingStats() {
  const db = getDb();
  const total = db.prepare("SELECT COUNT(*) as count FROM training_log").get() as { count: number };
  const thisMonth = db.prepare(`
    SELECT COUNT(*) as count FROM training_log
    WHERE date >= strftime('%Y-%m-01', 'now')
  `).get() as { count: number };
  const totalVolume = db.prepare("SELECT COALESCE(SUM(total_volume), 0) as sum FROM training_log").get() as { sum: number };
  const monthVolume = db.prepare(`
    SELECT COALESCE(SUM(total_volume), 0) as sum FROM training_log
    WHERE date >= strftime('%Y-%m-01', 'now')
  `).get() as { sum: number };
  const topExercises = db.prepare(`
    SELECT exercise_name, COUNT(*) as count
    FROM training_exercise
    GROUP BY exercise_name
    ORDER BY count DESC
    LIMIT 5
  `).all();
  return { totalSessions: total.count, monthSessions: thisMonth.count, totalVolume: totalVolume.sum, monthVolume: monthVolume.sum, topExercises };
}

// --- Rest days for calendar ---

export function queryRestDays(year: number, month: number) {
  const db = getDb();
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;
  return db.prepare(`
    SELECT date FROM daily_health WHERE rest_day = 1 AND date >= ? AND date < ?
  `).all(startDate, endDate);
}

// --- Export ---

export function exportAllTraining() {
  const db = getDb();
  const logs = db.prepare("SELECT * FROM training_log ORDER BY date ASC").all() as Record<string, unknown>[];
  const exercises = db.prepare("SELECT * FROM training_exercise ORDER BY training_log_id, id").all() as Record<string, unknown>[];
  return { logs, exercises };
}

export function exportAllHealth() {
  const db = getDb();
  return db.prepare("SELECT * FROM daily_health ORDER BY date ASC").all();
}
