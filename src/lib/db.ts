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
  `);
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
}) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO daily_health (date, hrv, resting_hr, systolic, diastolic, sleep_hours, sleep_quality, weight, body_fat, rpe, notes)
    VALUES (@date, @hrv, @resting_hr, @systolic, @diastolic, @sleep_hours, @sleep_quality, @weight, @body_fat, @rpe, @notes)
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
      notes = COALESCE(excluded.notes, daily_health.notes)
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
}[]) {
  const db = getDb();
  const insertLog = db.prepare(`
    INSERT INTO training_log (date, duration, total_volume, rpe, notes)
    VALUES (@date, @duration, @total_volume, @rpe, @notes)
  `);
  const insertExercise = db.prepare(`
    INSERT INTO training_exercise (training_log_id, exercise_name, muscle_group, sets, reps, weight)
    VALUES (?, @exercise_name, @muscle_group, @sets, @reps, @weight)
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
