import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { SleepTargets } from "./recovery";

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

    CREATE TABLE IF NOT EXISTS advice_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('daily', 'plan')),
      plan_id INTEGER,
      headline TEXT NOT NULL,
      detail TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'followed', 'partial', 'skipped')),
      felt_rpe INTEGER,
      body_notes TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      resolved_at TEXT
    );
    -- 日建议每天一条(dashboard 加载时 upsert);plan 建议一天可多条,按 plan_id 关联。
    CREATE UNIQUE INDEX IF NOT EXISTS ux_advice_daily ON advice_log(date) WHERE source = 'daily';

    CREATE TABLE IF NOT EXISTS insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id TEXT NOT NULL,
      date TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'alert')),
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      dismissed_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_insights_rule_day ON insights(rule_id, date);

    CREATE TABLE IF NOT EXISTS recovery_snapshots (
      date TEXT PRIMARY KEY,
      score INTEGER,
      zone TEXT,
      hrv_z REAL,
      resting_hr_dev REAL,
      sleep_debt_minutes INTEGER,
      load_7d INTEGER,
      acwr REAL,
      form REAL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS period_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('monthly')),
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS training_template (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      exercises TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS coach_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      source TEXT DEFAULT 'agent',
      pinned INTEGER DEFAULT 0,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS google_oauth_tokens (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at INTEGER NOT NULL,
      scope TEXT,
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS google_daily_metrics (
      date TEXT PRIMARY KEY,
      sleep_in_bed_minutes INTEGER,
      sleep_deep_minutes INTEGER,
      sleep_rem_minutes INTEGER,
      sleep_light_minutes INTEGER,
      sleep_awake_minutes INTEGER,
      sleep_bedtime TEXT,
      sleep_wakeup TEXT,
      hrv_avg_ms REAL,
      hrv_rmssd_deep_ms REAL,
      hrv_nonrem_hr REAL,
      hrv_entropy REAL,
      resting_hr INTEGER,
      respiratory_rate REAL,
      spo2_avg REAL,
      steps INTEGER,
      weight_kg REAL,
      exercise_count INTEGER,
      exercise_minutes INTEGER,
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS google_raw_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_type TEXT NOT NULL,
      data_date TEXT NOT NULL,
      point_count INTEGER,
      payload TEXT NOT NULL,
      fetched_at TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(data_type, data_date)
    );

    CREATE TABLE IF NOT EXISTS google_sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT,
      finished_at TEXT,
      status TEXT,
      message TEXT,
      types_synced TEXT
    );

    CREATE TABLE IF NOT EXISTS xunji_fetch_log (
      datestr TEXT PRIMARY KEY,
      trains_found INTEGER,
      fetched_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
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
  // 训记镜像:来源与外部 ID 用于幂等去重,title 存训练名(如"蹲"/"推")。
  const logCols = db.prepare("PRAGMA table_info(training_log)").all() as { name: string }[];
  if (!logCols.find((c) => c.name === "source")) {
    db.exec("ALTER TABLE training_log ADD COLUMN source TEXT DEFAULT 'manual'");
  }
  if (!logCols.find((c) => c.name === "external_id")) {
    db.exec("ALTER TABLE training_log ADD COLUMN external_id TEXT");
  }
  if (!logCols.find((c) => c.name === "title")) {
    db.exec("ALTER TABLE training_log ADD COLUMN title TEXT");
  }
  // 建议闭环:训练记录回链它执行的计划。
  if (!logCols.find((c) => c.name === "plan_id")) {
    db.exec("ALTER TABLE training_log ADD COLUMN plan_id INTEGER");
  }
  // 教练笔记:pinned=硬约束(不被条数上限挤出);expires_at=时效信息的到期日。
  const noteCols = db.prepare("PRAGMA table_info(coach_notes)").all() as { name: string }[];
  if (!noteCols.find((c) => c.name === "pinned")) {
    db.exec("ALTER TABLE coach_notes ADD COLUMN pinned INTEGER DEFAULT 0");
  }
  if (!noteCols.find((c) => c.name === "expires_at")) {
    db.exec("ALTER TABLE coach_notes ADD COLUMN expires_at TEXT");
  }
  // 聊天多会话:老库补 session_id 列,并把存量消息整体收进一条「历史对话」。
  const chatCols = db.prepare("PRAGMA table_info(chat_messages)").all() as { name: string }[];
  if (!chatCols.find((c) => c.name === "session_id")) {
    db.exec("ALTER TABLE chat_messages ADD COLUMN session_id INTEGER");
  }
  const orphans = db
    .prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE session_id IS NULL")
    .get() as { n: number };
  if (orphans.n > 0) {
    // 事务保证"建会话"与"归桶"要么都成要么都不成;重跑时已无孤儿行,天然幂等。
    db.transaction(() => {
      const { lastInsertRowid } = db
        .prepare("INSERT INTO chat_sessions (title) VALUES ('历史对话')")
        .run();
      db.prepare("UPDATE chat_messages SET session_id = ? WHERE session_id IS NULL").run(
        lastInsertRowid
      );
    })();
  }
  // 索引放在迁移之后建:老库里 session_id 列是 ALTER 补的,SCHEMA 阶段建索引会直接报错。
  db.exec("CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id)");
}

// --- App settings（用户可调参数，KV 存储） ---

export function getSetting(key: string): string | null {
  const db = getDb();
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now', 'localtime'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value);
}

export function deleteSetting(key: string): void {
  const db = getDb();
  db.prepare("DELETE FROM app_settings WHERE key = ?").run(key);
}

// 睡眠三档目标(分钟,null=未设):min=债务参照线地板;target=今晚建议地板;ideal=封顶。
// 类型定义随算法走(recovery.ts),这里只做存储映射。
export type { SleepTargets };

const SLEEP_TARGET_KEYS: Record<keyof SleepTargets, string> = {
  minMinutes: "sleep_min_minutes",
  targetMinutes: "sleep_target_minutes",
  idealMinutes: "sleep_ideal_minutes",
};

export function getSleepTargets(): SleepTargets {
  const out = {} as SleepTargets;
  for (const key of Object.keys(SLEEP_TARGET_KEYS) as (keyof SleepTargets)[]) {
    const raw = getSetting(SLEEP_TARGET_KEYS[key]);
    const n = raw === null ? NaN : Number(raw);
    out[key] = Number.isFinite(n) ? Math.round(n) : null;
  }
  return out;
}

// 传 null 的档位删除设置记录(回到"未设=纯历史均值"的现状行为)。
export function setSleepTargets(targets: SleepTargets): void {
  for (const key of Object.keys(SLEEP_TARGET_KEYS) as (keyof SleepTargets)[]) {
    const v = targets[key];
    if (v === null) deleteSetting(SLEEP_TARGET_KEYS[key]);
    else setSetting(SLEEP_TARGET_KEYS[key], String(v));
  }
}

// --- User profile(用户画像档案:目标/可训频率/时长/器材/作息/饮食,注入教练提示词) ---

export interface UserProfile {
  /** 训练目标,可多选(如 增肌/减脂/力量),空数组=未设 */
  goal: string[];
  /** 每周可训练天数范围;max 为 null = 固定 min 次。全 null=未设 */
  weeklyDaysMin: number | null;
  weeklyDaysMax: number | null;
  /** 单次训练可用时长(分钟)范围;max 为 null = 固定 min 分钟。全 null=未设 */
  sessionMinMinutes: number | null;
  sessionMaxMinutes: number | null;
  /** 器材/场地限制,空=未设 */
  equipment: string;
  /** 作息/时间窗(如工作日午休、夜班),空=未设 */
  schedule: string;
  /** 饮食约束(忌口/疾病相关),空=未设 */
  diet: string;
  /** 每周固定训练安排,7 项对应周一~周日,空串=休息/未安排;全空=未跟固定计划 */
  weeklySplit: string[];
}

export const USER_PROFILE_KEY = "user_profile";

const EMPTY_PROFILE: UserProfile = {
  goal: [],
  weeklyDaysMin: null,
  weeklyDaysMax: null,
  sessionMinMinutes: null,
  sessionMaxMinutes: null,
  equipment: "",
  schedule: "",
  diet: "",
  weeklySplit: ["", "", "", "", "", "", ""],
};

// 周计划规范成恰好 7 项(周一~周日),缺补空、多截断、非数组丢弃。
export function normalizeWeeklySplit(raw: unknown): string[] {
  const items = Array.isArray(raw) ? raw.slice(0, 7).map((s) => (typeof s === "string" ? s.trim().slice(0, 40) : "")) : [];
  while (items.length < 7) items.push("");
  return items;
}

export function getUserProfile(): UserProfile {
  const raw = getSetting(USER_PROFILE_KEY);
  if (!raw) return { ...EMPTY_PROFILE };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const profile: UserProfile = { ...EMPTY_PROFILE, ...parsed } as UserProfile;
    profile.weeklySplit = normalizeWeeklySplit(parsed.weeklySplit);
    // 旧版单值字段兼容:goal 字符串→数组;weeklyDays/sessionMinutes→min=max。
    if (typeof parsed.goal === "string") profile.goal = parsed.goal.trim() ? [parsed.goal.trim()] : [];
    const oldDays = parsed.weeklyDays;
    // 注意展开 EMPTY_PROFILE 后缺键是 null 而非 undefined,别用 undefined 判断。
    if (profile.weeklyDaysMin === null && typeof oldDays === "number") {
      profile.weeklyDaysMin = oldDays;
      profile.weeklyDaysMax = oldDays;
    }
    const oldMinutes = parsed.sessionMinutes;
    if (profile.sessionMinMinutes === null && typeof oldMinutes === "number") {
      profile.sessionMinMinutes = oldMinutes;
      profile.sessionMaxMinutes = oldMinutes;
    }
    return profile;
  } catch {
    return { ...EMPTY_PROFILE };
  }
}

export function setUserProfile(profile: UserProfile): void {
  // 只存有效字段;全空则删除设置记录,避免留一坨空 JSON。
  const p = { ...EMPTY_PROFILE, ...profile };
  const hasAny =
    p.goal.length > 0 ||
    p.weeklyDaysMin !== null ||
    p.weeklyDaysMax !== null ||
    p.sessionMinMinutes !== null ||
    p.sessionMaxMinutes !== null ||
    p.equipment.trim() !== "" ||
    p.schedule.trim() !== "" ||
    p.diet.trim() !== "" ||
    p.weeklySplit.some((s) => s.trim() !== "");
  if (!hasAny) deleteSetting(USER_PROFILE_KEY);
  else setSetting(USER_PROFILE_KEY, JSON.stringify(p));
}

// --- AI(LLM)配置 ---
// 用户决定:模型/地址/API Key 均可在 /settings 配置(存本表,优先级高于 .env;
// 清空则回落 env)。Key 属敏感值:任何 GET 接口只回掩码不回明文,见 api/settings。
export interface LlmSettings {
  model: string | null;
  baseUrl: string | null;
  apiKey: string | null;
}

const LLM_KEYS: Record<keyof LlmSettings, string> = {
  model: "llm_model",
  baseUrl: "llm_base_url",
  apiKey: "llm_api_key",
};

export function getLlmSettings(): LlmSettings {
  const out = {} as LlmSettings;
  for (const key of Object.keys(LLM_KEYS) as (keyof LlmSettings)[]) {
    out[key] = getSetting(LLM_KEYS[key]);
  }
  return out;
}

// patch 三态:undefined=该项不变;null 或 ""=清除(回落 .env);非空字符串=写入。
export function setLlmSettings(patch: Partial<LlmSettings>): void {
  for (const key of Object.keys(LLM_KEYS) as (keyof LlmSettings)[]) {
    const v = patch[key];
    if (v === undefined) continue;
    if (v === null || v === "") deleteSetting(LLM_KEYS[key]);
    else setSetting(LLM_KEYS[key], v);
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
  // 升序（旧→新），与 queryBodyComposition 一致，折线图横轴从左到右为时间正序。
  return db.prepare(`
    SELECT * FROM daily_health
    WHERE date >= date('now', 'localtime', '-' || ? || ' days')
    ORDER BY date ASC
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
  plan_id?: number | null;
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
    INSERT INTO training_log (date, duration, total_volume, rpe, notes, plan_id)
    VALUES (@date, @duration, @total_volume, @rpe, @notes, @plan_id)
  `);
  const insertExercise = db.prepare(`
    INSERT INTO training_exercise (training_log_id, exercise_name, muscle_group, sets, reps, weight, bodyweight, rpe)
    VALUES (?, @exercise_name, @muscle_group, @sets, @reps, @weight, @bodyweight, @rpe)
  `);
  // 可选键缺失时 better-sqlite3 对命名参数直接抛错,统一补齐。
  const logRow = { ...data, plan_id: data.plan_id ?? null };

  const transaction = db.transaction(() => {
    const result = insertLog.run(logRow);
    const logId = result.lastInsertRowid;
    for (const ex of exercises) {
      insertExercise.run(logId, ex);
    }
    // 自动回链即自动销账:执行了哪条计划,该计划的建议记"已采纳",体感取本次训练 RPE。
    if (data.plan_id) {
      db.prepare(`
        UPDATE advice_log
           SET status = 'followed',
               felt_rpe = COALESCE(?, felt_rpe),
               resolved_at = datetime('now', 'localtime')
         WHERE source = 'plan' AND plan_id = ? AND status = 'pending'
      `).run(data.rpe ?? null, data.plan_id);
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
    WHERE tl.date >= date('now', 'localtime', '-' || ? || ' days')
    GROUP BY tl.id
    ORDER BY tl.date DESC
  `).all(days);
}

export function queryTrainingHistoryDetailed(days: number) {
  const db = getDb();
  const logs = db.prepare(`
    SELECT * FROM training_log
    WHERE date >= date('now', 'localtime', '-' || ? || ' days')
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
      CAST(julianday('now', 'localtime') - julianday(MAX(tl.date)) AS INTEGER) as days_since,
      SUM(te.sets * te.reps * te.weight) as total_volume_7d
    FROM training_exercise te
    JOIN training_log tl ON tl.id = te.training_log_id
    WHERE tl.date >= date('now', 'localtime', '-7 days')
    GROUP BY te.muscle_group
    ORDER BY days_since ASC
  `).all();
}

// --- Body composition ---

export function queryBodyComposition(days: number) {
  const db = getDb();
  return db.prepare(`
    SELECT date, weight, body_fat FROM daily_health
    WHERE weight IS NOT NULL AND date >= date('now', 'localtime', '-' || ? || ' days')
    ORDER BY date ASC
  `).all(days);
}

// --- Chat history (教练对话持久化,按会话分桶) ---

export interface ChatMessageRow {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface ChatSessionRow {
  id: number;
  title: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export function createChatSession(title: string | null = null): { id: number; title: string | null } {
  const db = getDb();
  const { lastInsertRowid } = db
    .prepare("INSERT INTO chat_sessions (title) VALUES (?)")
    .run(title);
  return { id: Number(lastInsertRowid), title };
}

export function listChatSessions(): ChatSessionRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT s.id, s.title, s.created_at, s.updated_at,
              COUNT(m.id) AS message_count
         FROM chat_sessions s
         LEFT JOIN chat_messages m ON m.session_id = s.id
        GROUP BY s.id
        ORDER BY s.updated_at DESC, s.id DESC`
    )
    .all() as ChatSessionRow[];
}

// 取会话最近 limit 条消息,时间正序返回。
export function getChatMessages(sessionId: number, limit: number = 60): ChatMessageRow[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT id, role, content, created_at FROM (SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC"
    )
    .all(sessionId, limit) as ChatMessageRow[];
}

export function insertChatMessage(
  sessionId: number,
  role: "user" | "assistant",
  content: string
): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)").run(
      sessionId,
      role,
      content
    );
    db.prepare(
      "UPDATE chat_sessions SET updated_at = datetime('now', 'localtime') WHERE id = ?"
    ).run(sessionId);
    // 无名会话以首条用户消息定标题:取第一行、截 24 字,列表里一眼可辨。
    if (role === "user") {
      const firstLine = content.split("\n")[0]?.trim().slice(0, 24) ?? "";
      if (firstLine) {
        db.prepare(
          "UPDATE chat_sessions SET title = ? WHERE id = ? AND (title IS NULL OR title = '')"
        ).run(firstLine, sessionId);
      }
    }
  })();
}

export function deleteChatSession(id: number): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM chat_messages WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(id);
  })();
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
  // plan_date 是 Zod optional:LLM 不传时键会缺失,better-sqlite3 对缺失命名参数直接抛错,必须补默认值。
  // 手动自建计划没有 AI 的分析/恢复评估,置空即可,列表渲染按空值跳过。
  const { plan_date = null, analysis_summary = "", recovery_assessment = "", advice = "", ...required } = plan;
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO training_plan (date, plan_date, analysis_summary, recovery_assessment, exercises, advice)
    VALUES (@date, @plan_date, @analysis_summary, @recovery_assessment, @exercises, @advice)
  `).run({ ...required, plan_date, analysis_summary, recovery_assessment, advice });
  return Number(lastInsertRowid);
}

export function getTrainingPlans(limit: number = 20) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM training_plan ORDER BY created_at DESC, id DESC LIMIT ?
  `).all(limit);
}

export function deleteTrainingPlan(id: number): void {
  const db = getDb();
  db.prepare("DELETE FROM training_plan WHERE id = ?").run(id);
}

// --- Advice closed loop (建议闭环:日建议/计划建议的采纳与体感回填) ---

export interface AdviceRow {
  id: number;
  date: string;
  source: "daily" | "plan";
  plan_id: number | null;
  headline: string;
  detail: string | null;
  status: "pending" | "followed" | "partial" | "skipped";
  felt_rpe: number | null;
  body_notes: string | null;
  created_at: string;
  resolved_at: string | null;
}

export const ADVICE_STATUSES = ["followed", "partial", "skipped"] as const;
export type AdviceStatus = (typeof ADVICE_STATUSES)[number];

// 日建议 upsert:同日再算(headline 变了)就刷新文案,但用户已回填的状态/体感不覆盖。
export function upsertDailyAdvice(
  date: string,
  headline: string,
  detail: string | null
): AdviceRow {
  const db = getDb();
  db.prepare(`
    INSERT INTO advice_log (date, source, headline, detail)
    VALUES (?, 'daily', ?, ?)
    ON CONFLICT(date) WHERE source = 'daily'
    DO UPDATE SET headline = excluded.headline, detail = excluded.detail
  `).run(date, headline, detail);
  return db
    .prepare("SELECT * FROM advice_log WHERE source = 'daily' AND date = ?")
    .get(date) as AdviceRow;
}

// 计划建议存档:保存训练计划的同时记一条 source='plan' 的建议,
// 日期用目标日(plan_date),无目标日则用生成日;执行该计划时自动销账。
export function savePlanAdvice(planId: number, date: string, headline: string, detail: string | null): void {
  const db = getDb();
  db.prepare("INSERT INTO advice_log (date, source, plan_id, headline, detail) VALUES (?, 'plan', ?, ?, ?)").run(
    date,
    planId,
    headline,
    detail
  );
}

export function getAdvice(id: number): AdviceRow | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM advice_log WHERE id = ?").get(id) as
    | AdviceRow
    | undefined;
}

// 快捷反馈回填:状态必给,体感 RPE/一句话可选(可反复修改)。
export function resolveAdvice(
  id: number,
  status: AdviceStatus,
  feltRpe: number | null,
  bodyNotes: string | null
): void {
  const db = getDb();
  db.prepare(`
    UPDATE advice_log
       SET status = @status,
           felt_rpe = COALESCE(@feltRpe, felt_rpe),
           body_notes = COALESCE(@bodyNotes, body_notes),
           resolved_at = datetime('now', 'localtime')
     WHERE id = @id
  `).run({ id, status, feltRpe, bodyNotes });
}

// 给 AI 的闭环读数:近期建议 + 执行情况。plan 建议附带该计划实际练了什么
// (回链 training_log 的容量/RPE),没练则显式标"未执行"。
export function queryAdviceHistory(days: number) {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT a.*,
             (SELECT COUNT(*) FROM training_log tl WHERE tl.plan_id = a.plan_id) AS executed,
             (SELECT SUM(tl.total_volume) FROM training_log tl WHERE tl.plan_id = a.plan_id) AS actual_volume,
             (SELECT MAX(tl.rpe) FROM training_log tl WHERE tl.plan_id = a.plan_id) AS actual_rpe
        FROM advice_log a
       WHERE a.date >= date('now', 'localtime', '-' || ? || ' days')
       ORDER BY a.date DESC, a.id DESC
       LIMIT 40
    `)
    .all(days) as (AdviceRow & {
      executed: number;
      actual_volume: number | null;
      actual_rpe: number | null;
    })[];
  // 只回传给判断有用的字段,控制进提示词的 token 量;detail 以 advice 名义给 AI(与训练计划表字段一致)。
  return rows.map((a) => ({
    date: a.date,
    source: a.source,
    status: a.status,
    headline: a.headline,
    felt_rpe: a.felt_rpe,
    ...(a.body_notes ? { body_notes: a.body_notes } : {}),
    ...(a.detail ? { advice: a.detail } : {}),
    ...(a.plan_id ? { plan_id: a.plan_id } : {}),
    executed: a.executed,
    actual_volume: a.actual_volume,
    actual_rpe: a.actual_rpe,
  }));
}

// 近 days 天 daily 建议里仍处于 pending(未回填)的条数——洞察规则用来轻推闭环回填。
export function countStalePendingAdvice(days: number): number {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM advice_log WHERE source = 'daily' AND status = 'pending' AND date < date('now','localtime') AND date >= date('now','localtime','-' || ? || ' days')"
    )
    .get(days) as { n: number };
  return row.n;
}

// --- Insights(主动洞察:sync 后规则引擎产出,总览横幅展示,可关掉) ---

export interface InsightRow {
  id: number;
  rule_id: string;
  date: string;
  level: "info" | "warn" | "alert";
  title: string;
  detail: string;
  created_at: string;
  dismissed_at: string | null;
}

// 同一规则一天最多一条:重算刷新文案,不复活已关掉的横幅。
export function upsertInsight(
  ruleId: string,
  date: string,
  level: InsightRow["level"],
  title: string,
  detail: string
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO insights (rule_id, date, level, title, detail)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(rule_id, date)
    DO UPDATE SET level = excluded.level, title = excluded.title, detail = excluded.detail
  `).run(ruleId, date, level, title, detail);
}

// 最近 days 天内未被关掉的洞察,最多 limit 条。
export function getActiveInsights(days: number = 3, limit: number = 5): InsightRow[] {
  const db = getDb();
  return db
    .prepare(`
      SELECT * FROM insights
       WHERE dismissed_at IS NULL AND date >= date('now','localtime','-' || ? || ' days')
       ORDER BY CASE level WHEN 'alert' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, date DESC, id DESC
       LIMIT ?
    `)
    .all(days, limit) as InsightRow[];
}

export function dismissInsight(id: number): void {
  const db = getDb();
  db.prepare("UPDATE insights SET dismissed_at = datetime('now','localtime') WHERE id = ?").run(id);
}

// --- 阶段复盘(每日恢复快照 + 周期报告持久化) ---

export interface RecoverySnapshot {
  date: string;
  score: number | null;
  zone: string | null;
  hrv_z: number | null;
  resting_hr_dev: number | null;
  sleep_debt_minutes: number | null;
  load_7d: number | null;
  acwr: number | null;
  form: number | null;
}

// dashboard 每次计算顺手存档:同日重算刷新数值,趋势随数据修正。
export function upsertRecoverySnapshot(s: {
  date: string;
  score: number | null;
  zone: string | null;
  hrv_z: number | null;
  resting_hr_dev: number | null;
  sleep_debt_minutes: number | null;
  load_7d: number | null;
  acwr: number | null;
  form: number | null;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO recovery_snapshots (date, score, zone, hrv_z, resting_hr_dev, sleep_debt_minutes, load_7d, acwr, form, updated_at)
    VALUES (@date, @score, @zone, @hrv_z, @resting_hr_dev, @sleep_debt_minutes, @load_7d, @acwr, @form, datetime('now','localtime'))
    ON CONFLICT(date) DO UPDATE SET
      score = excluded.score, zone = excluded.zone, hrv_z = excluded.hrv_z,
      resting_hr_dev = excluded.resting_hr_dev, sleep_debt_minutes = excluded.sleep_debt_minutes,
      load_7d = excluded.load_7d, acwr = excluded.acwr, form = excluded.form,
      updated_at = datetime('now','localtime')
  `).run(s);
}

// 近 days 天快照,日期升序(阶段复盘的输入)。
export function getRecoverySnapshots(days: number): RecoverySnapshot[] {
  const db = getDb();
  return db
    .prepare(`
      SELECT date, score, zone, hrv_z, resting_hr_dev, sleep_debt_minutes, load_7d, acwr, form
        FROM recovery_snapshots
       WHERE date >= date('now','localtime','-' || ? || ' days')
       ORDER BY date ASC
    `)
    .all(days) as RecoverySnapshot[];
}

export interface PeriodReport {
  id: number;
  kind: "monthly";
  period_start: string;
  period_end: string;
  content: string;
  created_at: string;
}

export function savePeriodReport(kind: "monthly", periodStart: string, periodEnd: string, content: string): number {
  const db = getDb();
  const { lastInsertRowid } = db
    .prepare("INSERT INTO period_reports (kind, period_start, period_end, content) VALUES (?, ?, ?, ?)")
    .run(kind, periodStart, periodEnd, content);
  return Number(lastInsertRowid);
}

export function listPeriodReports(kind: "monthly", limit: number = 12): PeriodReport[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM period_reports WHERE kind = ? ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(kind, limit) as PeriodReport[];
}

export function deletePeriodReport(id: number): void {
  const db = getDb();
  db.prepare("DELETE FROM period_reports WHERE id = ?").run(id);
}

// --- Coach notes (教练笔记:跨会话的个人情况记忆) ---
// pinned=1 是硬约束(疾病/忌口等),排序优先且不被条数上限挤出;
// expires_at 到期后不再注入提示词(getActiveCoachNotes),UI 仍展示全量以便清理。

export interface CoachNote {
  id: number;
  content: string;
  source: string;
  pinned: number;
  expires_at: string | null;
  created_at: string;
}

// 上限 30 条:笔记是全量注入系统提示词的,无上限会随时间膨胀;超出后未置顶里最旧的先失效。
export function getCoachNotes(limit: number = 30): CoachNote[] {
  const db = getDb();
  return db.prepare(
    "SELECT id, content, source, pinned, expires_at, created_at FROM coach_notes ORDER BY pinned DESC, id DESC LIMIT ?"
  ).all(limit) as CoachNote[];
}

// 提示词注入用:过滤已过期笔记。
export function getActiveCoachNotes(limit: number = 30): CoachNote[] {
  const db = getDb();
  return db.prepare(
    `SELECT id, content, source, pinned, expires_at, created_at FROM coach_notes
     WHERE expires_at IS NULL OR expires_at > date('now', 'localtime')
     ORDER BY pinned DESC, id DESC LIMIT ?`
  ).all(limit) as CoachNote[];
}

export function insertCoachNote(
  content: string,
  source: string,
  opts: { pinned?: boolean; expires_at?: string | null } = {}
): CoachNote {
  const db = getDb();
  const r = db
    .prepare("INSERT INTO coach_notes (content, source, pinned, expires_at) VALUES (?, ?, ?, ?)")
    .run(content, source, opts.pinned ? 1 : 0, opts.expires_at ?? null);
  return {
    id: Number(r.lastInsertRowid),
    content,
    source,
    pinned: opts.pinned ? 1 : 0,
    expires_at: opts.expires_at ?? null,
    created_at: new Date().toISOString(),
  };
}

export function updateCoachNotePinned(id: number, pinned: boolean): void {
  const db = getDb();
  db.prepare("UPDATE coach_notes SET pinned = ? WHERE id = ?").run(pinned ? 1 : 0, id);
}

// 返回是否真的删了行:DELETE API 与整理任务据此判断目标是否存在。
export function deleteCoachNote(id: number): boolean {
  const db = getDb();
  return Number(db.prepare("DELETE FROM coach_notes WHERE id = ?").run(id).changes) > 0;
}

// 后台记忆整理的原子操作。update 的 expires_at:undefined=保持不变,显式 null=清除;
// 目标已不存在的操作静默跳过;整个批次在一个事务里套用。
export type CoachNoteOp =
  | { op: "add"; content: string; pinned?: boolean; expires_at?: string | null }
  | { op: "update"; id: number; content?: string; pinned?: boolean; expires_at?: string | null }
  | { op: "delete"; id: number };

export function applyCoachNoteOps(ops: CoachNoteOp[]): { added: number; updated: number; deleted: number } {
  const db = getDb();
  const apply = db.transaction((list: CoachNoteOp[]) => {
    let added = 0;
    let updated = 0;
    let deleted = 0;
    for (const op of list) {
      if (op.op === "add") {
        insertCoachNote(op.content, "agent", { pinned: op.pinned, expires_at: op.expires_at ?? null });
        added++;
      } else if (op.op === "update") {
        const cur = db.prepare("SELECT content, pinned, expires_at FROM coach_notes WHERE id = ?").get(op.id) as
          | { content: string; pinned: number; expires_at: string | null }
          | undefined;
        if (!cur) continue;
        db.prepare("UPDATE coach_notes SET content = ?, pinned = ?, expires_at = ? WHERE id = ?").run(
          op.content ?? cur.content,
          (op.pinned ?? Boolean(cur.pinned)) ? 1 : 0,
          op.expires_at === undefined ? cur.expires_at : op.expires_at,
          op.id
        );
        updated++;
      } else if (deleteCoachNote(op.id)) {
        deleted++;
      }
    }
    return { added, updated, deleted };
  });
  return apply(ops);
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
      AND tl.date >= date('now', 'localtime', '-' || ? || ' days')
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
    WHERE date >= strftime('%Y-%m-01', 'now', 'localtime')
  `).get() as { count: number };
  const totalVolume = db.prepare("SELECT COALESCE(SUM(total_volume), 0) as sum FROM training_log").get() as { sum: number };
  const monthVolume = db.prepare(`
    SELECT COALESCE(SUM(total_volume), 0) as sum FROM training_log
    WHERE date >= strftime('%Y-%m-01', 'now', 'localtime')
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

// --- Google Health sync ---

export interface GoogleTokens {
  access_token: string;
  refresh_token: string | null;
  expires_at: number;
  scope: string | null;
}

export function saveGoogleTokens(tokens: GoogleTokens) {
  const db = getDb();
  db.prepare(`
    INSERT INTO google_oauth_tokens (id, access_token, refresh_token, expires_at, scope, updated_at)
    VALUES (1, @access_token, @refresh_token, @expires_at, @scope, datetime('now', 'localtime'))
    ON CONFLICT(id) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = COALESCE(excluded.refresh_token, google_oauth_tokens.refresh_token),
      expires_at = excluded.expires_at,
      scope = COALESCE(excluded.scope, google_oauth_tokens.scope),
      updated_at = datetime('now', 'localtime')
  `).run(tokens);
}

export function getGoogleTokens(): GoogleTokens | undefined {
  const db = getDb();
  return db.prepare("SELECT access_token, refresh_token, expires_at, scope FROM google_oauth_tokens WHERE id = 1").get() as GoogleTokens | undefined;
}

export function deleteGoogleTokens() {
  const db = getDb();
  db.prepare("DELETE FROM google_oauth_tokens WHERE id = 1").run();
}

export interface GoogleDailyMetricsInput {
  date: string;
  sleep_in_bed_minutes?: number | null;
  sleep_deep_minutes?: number | null;
  sleep_rem_minutes?: number | null;
  sleep_light_minutes?: number | null;
  sleep_awake_minutes?: number | null;
  sleep_bedtime?: string | null;
  sleep_wakeup?: string | null;
  hrv_avg_ms?: number | null;
  hrv_rmssd_deep_ms?: number | null;
  hrv_nonrem_hr?: number | null;
  hrv_entropy?: number | null;
  resting_hr?: number | null;
  respiratory_rate?: number | null;
  spo2_avg?: number | null;
  steps?: number | null;
  weight_kg?: number | null;
  exercise_count?: number | null;
  exercise_minutes?: number | null;
}

// 部分更新：各数据类型只写自己的列，未涉及的列保留旧值（与 upsertHealth 同模式）。
export function upsertGoogleDailyMetrics(data: GoogleDailyMetricsInput) {
  const db = getDb();
  // better-sqlite3 要求语句中每个命名参数都有值，先铺全列默认值再覆盖传入项。
  const row: Record<string, unknown> = {
    sleep_in_bed_minutes: null,
    sleep_deep_minutes: null,
    sleep_rem_minutes: null,
    sleep_light_minutes: null,
    sleep_awake_minutes: null,
    sleep_bedtime: null,
    sleep_wakeup: null,
    hrv_avg_ms: null,
    hrv_rmssd_deep_ms: null,
    hrv_nonrem_hr: null,
    hrv_entropy: null,
    resting_hr: null,
    respiratory_rate: null,
    spo2_avg: null,
    steps: null,
    weight_kg: null,
    exercise_count: null,
    exercise_minutes: null,
    synced_at: new Date().toISOString(),
    ...data,
  };
  db.prepare(`
    INSERT INTO google_daily_metrics (
      date, sleep_in_bed_minutes, sleep_deep_minutes, sleep_rem_minutes, sleep_light_minutes, sleep_awake_minutes,
      sleep_bedtime, sleep_wakeup, hrv_avg_ms, hrv_rmssd_deep_ms, hrv_nonrem_hr, hrv_entropy,
      resting_hr, respiratory_rate, spo2_avg, steps, weight_kg, exercise_count, exercise_minutes, synced_at
    ) VALUES (
      @date, @sleep_in_bed_minutes, @sleep_deep_minutes, @sleep_rem_minutes, @sleep_light_minutes, @sleep_awake_minutes,
      @sleep_bedtime, @sleep_wakeup, @hrv_avg_ms, @hrv_rmssd_deep_ms, @hrv_nonrem_hr, @hrv_entropy,
      @resting_hr, @respiratory_rate, @spo2_avg, @steps, @weight_kg, @exercise_count, @exercise_minutes, @synced_at
    )
    ON CONFLICT(date) DO UPDATE SET
      sleep_in_bed_minutes = COALESCE(excluded.sleep_in_bed_minutes, google_daily_metrics.sleep_in_bed_minutes),
      sleep_deep_minutes = COALESCE(excluded.sleep_deep_minutes, google_daily_metrics.sleep_deep_minutes),
      sleep_rem_minutes = COALESCE(excluded.sleep_rem_minutes, google_daily_metrics.sleep_rem_minutes),
      sleep_light_minutes = COALESCE(excluded.sleep_light_minutes, google_daily_metrics.sleep_light_minutes),
      sleep_awake_minutes = COALESCE(excluded.sleep_awake_minutes, google_daily_metrics.sleep_awake_minutes),
      sleep_bedtime = COALESCE(excluded.sleep_bedtime, google_daily_metrics.sleep_bedtime),
      sleep_wakeup = COALESCE(excluded.sleep_wakeup, google_daily_metrics.sleep_wakeup),
      hrv_avg_ms = COALESCE(excluded.hrv_avg_ms, google_daily_metrics.hrv_avg_ms),
      hrv_rmssd_deep_ms = COALESCE(excluded.hrv_rmssd_deep_ms, google_daily_metrics.hrv_rmssd_deep_ms),
      hrv_nonrem_hr = COALESCE(excluded.hrv_nonrem_hr, google_daily_metrics.hrv_nonrem_hr),
      hrv_entropy = COALESCE(excluded.hrv_entropy, google_daily_metrics.hrv_entropy),
      resting_hr = COALESCE(excluded.resting_hr, google_daily_metrics.resting_hr),
      respiratory_rate = COALESCE(excluded.respiratory_rate, google_daily_metrics.respiratory_rate),
      spo2_avg = COALESCE(excluded.spo2_avg, google_daily_metrics.spo2_avg),
      steps = COALESCE(excluded.steps, google_daily_metrics.steps),
      weight_kg = COALESCE(excluded.weight_kg, google_daily_metrics.weight_kg),
      exercise_count = COALESCE(excluded.exercise_count, google_daily_metrics.exercise_count),
      exercise_minutes = COALESCE(excluded.exercise_minutes, google_daily_metrics.exercise_minutes),
      synced_at = excluded.synced_at
  `).run(row);
}

export function queryGoogleDailyMetrics(days: number = 7) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM google_daily_metrics
    ORDER BY date DESC LIMIT ?
  `).all(days);
}

// 升序（旧→新）版本：供基线/趋势计算与 LLM 查看走势。
export function queryGoogleDailyMetricsRange(days: number) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM google_daily_metrics
    WHERE date >= date('now', 'localtime', '-' || ? || ' days')
    ORDER BY date ASC
  `).all(days);
}

export function saveGoogleRawData(dataType: string, dataDate: string, points: unknown[]) {
  const db = getDb();
  db.prepare(`
    INSERT INTO google_raw_data (data_type, data_date, point_count, payload, fetched_at)
    VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
    ON CONFLICT(data_type, data_date) DO UPDATE SET
      point_count = excluded.point_count,
      payload = excluded.payload,
      fetched_at = excluded.fetched_at
  `).run(dataType, dataDate, points.length, JSON.stringify(points));
}

export function queryGoogleRawTypeCounts(date: string) {
  const db = getDb();
  return db.prepare(`
    SELECT data_type, SUM(point_count) as points
    FROM google_raw_data
    WHERE data_date >= ?
    GROUP BY data_type
  `).all(date) as { data_type: string; points: number }[];
}

export function insertSyncLog(startedAt: string): number {
  const db = getDb();
  return Number(db.prepare("INSERT INTO google_sync_log (started_at, status) VALUES (?, 'running')").run(startedAt).lastInsertRowid);
}

export function finishSyncLog(id: number, fields: { finished_at: string; status: string; message?: string | null; types_synced?: string | null }) {
  const db = getDb();
  db.prepare(`
    UPDATE google_sync_log
    SET finished_at = @finished_at, status = @status, message = @message, types_synced = @types_synced
    WHERE id = ?
  `).run({ message: null, types_synced: null, ...fields }, id);
}

// 服务崩溃/重启会让同步日志永远停在 running,启动时统一标记为中断。
export function markInterruptedSyncLogs() {
  const db = getDb();
  db.prepare(`
    UPDATE google_sync_log
    SET status = 'error', finished_at = ?, message = '同步中断(服务重启)'
    WHERE status = 'running'
  `).run(new Date().toISOString());
}

export function getLastSyncLog() {
  const db = getDb();
  return db.prepare("SELECT * FROM google_sync_log ORDER BY id DESC LIMIT 1").get() as Record<string, unknown> | undefined;
}

export function getLastSuccessfulSyncDate(): string | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT finished_at FROM google_sync_log
    WHERE status = 'success' AND finished_at IS NOT NULL
    ORDER BY id DESC LIMIT 1
  `).get() as { finished_at: string } | undefined;
  return row ? row.finished_at.slice(0, 10) : null;
}

// --- XunJi (训记) sync ---

export interface XunjiExerciseRow {
  exercise_name: string;
  muscle_group: string;
  reps: number | null;
  weight: number | null;
  rpe: number | null;
}

export function findTrainingLogByExternalId(externalId: string): { id: number } | undefined {
  const db = getDb();
  return db
    .prepare("SELECT id FROM training_log WHERE source = 'xunji' AND external_id = ?")
    .get(externalId) as { id: number } | undefined;
}

// 每组一行(training_exercise.sets=1),与手动录入的存储约定一致。返回是否为新建。
export function upsertXunjiTraining(
  data: { date: string; title: string | null; duration: number; notes: string | null; external_id: string },
  exercises: XunjiExerciseRow[]
): { logId: number; created: boolean } {
  const db = getDb();
  const existing = findTrainingLogByExternalId(data.external_id);
  // 每行一组(sets=1),容量 = Σ 次数×重量;否则训练统计的 SUM(total_volume) 会漏掉全部镜像数据。
  const totalVolume = exercises.reduce((acc, e) => acc + (e.reps ?? 0) * (e.weight ?? 0), 0);
  const tx = db.transaction(() => {
    let logId: number;
    const created = !existing;
    if (existing) {
      db.prepare(`
        UPDATE training_log SET date = @date, duration = @duration, total_volume = @total_volume, notes = @notes, title = @title
        WHERE id = @id
      `).run({ ...data, total_volume: totalVolume, id: existing.id });
      logId = existing.id;
      db.prepare("DELETE FROM training_exercise WHERE training_log_id = ?").run(logId);
    } else {
      const r = db.prepare(`
        INSERT INTO training_log (date, duration, total_volume, notes, source, external_id, title)
        VALUES (@date, @duration, @total_volume, @notes, 'xunji', @external_id, @title)
      `).run({ ...data, total_volume: totalVolume });
      logId = Number(r.lastInsertRowid);
    }
    const ins = db.prepare(`
      INSERT INTO training_exercise (training_log_id, exercise_name, muscle_group, sets, reps, weight, bodyweight, rpe)
      VALUES (?, @exercise_name, @muscle_group, 1, @reps, @weight, 0, @rpe)
    `);
    for (const ex of exercises) ins.run(logId, ex);
    return { logId, created };
  });
  return tx();
}

export function markDatestrFetched(datestr: string, trainsFound: number) {
  const db = getDb();
  db.prepare(`
    INSERT INTO xunji_fetch_log (datestr, trains_found, fetched_at)
    VALUES (?, ?, datetime('now', 'localtime'))
    ON CONFLICT(datestr) DO UPDATE SET
      trains_found = excluded.trains_found,
      fetched_at = excluded.fetched_at
  `).run(datestr, trainsFound);
}

// 拉到 0 条的日期:可能只是查询时还没录入/没上传,非强刷同步应保持可重试。
export function getEmptyFetchedDatestrs(): string[] {
  const db = getDb();
  return (db.prepare("SELECT datestr FROM xunji_fetch_log WHERE trains_found = 0").all() as { datestr: string }[])
    .map((r) => r.datestr);
}

export function getFetchedDatestrs(): string[] {
  const db = getDb();
  return (db.prepare("SELECT datestr FROM xunji_fetch_log").all() as { datestr: string }[]).map((r) => r.datestr);
}

export function getXunjiFetchInfo() {
  const db = getDb();
  const datesFetched = (db.prepare("SELECT COUNT(*) as n FROM xunji_fetch_log").get() as { n: number }).n;
  const latest = db
    .prepare("SELECT datestr, trains_found, fetched_at FROM xunji_fetch_log ORDER BY datestr DESC LIMIT 1")
    .get() as { datestr: string; trains_found: number; fetched_at: string } | undefined;
  return { datesFetched, latest };
}
