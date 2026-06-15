/**
 * wger 动作库种子脚本（一次性运行，可幂等重跑）。
 *
 * 数据流：
 *   /exercise-translation/?language=2  → name（2000+ 英文动作）
 *   /exercise/?language=2&status=2     → category / equipment / muscles（通过 exercise id 关联）
 *   /exercisecategory/                 → id → 名字（如 11 → Chest）
 *   /equipment/                        → id → 名字（如 3 → Dumbbell）
 *
 * 写入本地 SQLite exercise_library 表，之后动作搜索只读本地，零延迟、离线可用。
 *
 * 用法：npm run seed:wger
 */

import Database from "better-sqlite3";
import path from "path";

const WGER = "https://wger.de/api/v2";
const DB_PATH = path.join(process.cwd(), "data", "body-watcher.db");
// 每次请求间隔(ms)，避免给 wger 服务器压力。
const SLEEP_MS = 300;
// 一次拉取多少页后打印进度。
const PROGRESS_EVERY = 100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface WgerPaginated<T> {
  count: number;
  next: string | null;
  results: T[];
}

async function fetchAllPages<T>(endpoint: string): Promise<T[]> {
  const all: T[] = [];
  let url: string | null = `${WGER}/${endpoint}/?format=json`;
  let pageCount = 0;
  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`wger ${url} -> ${res.status}`);
    const data = (await res.json()) as WgerPaginated<T>;
    all.push(...data.results);
    pageCount++;
    if (pageCount % PROGRESS_EVERY === 0) {
      console.log(`  …已拉取 ${all.length}/${data.count}`);
    }
    url = data.next;
    if (url) await sleep(SLEEP_MS);
  }
  return all;
}

interface Translation {
  id: number;
  name: string;
  exercise: number; // 指向 exercise.id
}
interface Exercise {
  id: number;
  category: number;
  equipment: number[];
  muscles: number[];
  muscles_secondary: number[];
}
interface Lookup {
  id: number;
  name: string;
}
interface Muscle extends Lookup {
  name_en: string;
}

async function main() {
  console.log("→ 拉取 exercise-translation (language=2)…");
  const translations = await fetchAllPages<Translation>(
    "exercise-translation?language=2"
  );
  console.log(`  ${translations.length} 条翻译`);

  console.log("→ 拉取 exercise (language=2, status=2)…");
  const exercises = await fetchAllPages<Exercise>("exercise?language=2&status=2");
  console.log(`  ${exercises.length} 条已审核动作`);

  console.log("→ 拉取 category / equipment / muscle lookup 表…");
  const categories = await fetchAllPages<Lookup>("exercisecategory");
  const equipments = await fetchAllPages<Lookup>("equipment");
  const muscles = await fetchAllPages<Muscle>("muscle");
  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
  const equipmentMap = new Map(equipments.map((e) => [e.id, e.name]));
  // 肌群取常用英文名（name_en，如 "Chest"），拉丁名对普通用户不友好。
  const muscleMap = new Map(muscles.map((m) => [m.id, m.name_en]));

  // 关联：translation.exercise → exercise.id，拿到 category/equipment/muscles。
  const exerciseMap = new Map(exercises.map((e) => [e.id, e]));

  console.log("→ 写入本地数据库…");
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  // 确保表存在（与 src/lib/db.ts 的 schema 保持一致）。
  db.exec(`
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

  const insert = db.prepare(`
    INSERT OR IGNORE INTO exercise_library (name, muscle_group, equipment, category, wger_id, image_url)
    VALUES (@name, @muscle_group, @equipment, @category, @wger_id, @image_url)
  `);
  const tx = db.transaction((rows: Array<Record<string, unknown>>) => {
    for (const row of rows) insert.run(row);
  });

  const rows: Array<Record<string, unknown>> = [];
  let skipped = 0;
  for (const t of translations) {
    const name = t.name?.trim();
    if (!name) {
      skipped++;
      continue;
    }
    const ex = exerciseMap.get(t.exercise);
    const equipmentNames = (ex?.equipment ?? [])
      .map((id) => equipmentMap.get(id))
      .filter(Boolean)
      .join(", ");
    // muscle_group 取主肌群（muscles[0]）的常用英文名；无肌群信息时回退到分类名。
    const primaryMuscle = ex?.muscles?.[0];
    const muscleName = primaryMuscle ? muscleMap.get(primaryMuscle) ?? null : null;
    const categoryName = ex ? categoryMap.get(ex.category) ?? null : null;
    rows.push({
      name,
      muscle_group: muscleName ?? categoryName,
      equipment: equipmentNames || null,
      category: categoryName,
      wger_id: t.exercise,
      image_url: null,
    });
  }
  tx(rows);

  const total = (
    db.prepare("SELECT COUNT(*) as n FROM exercise_library").get() as { n: number }
  ).n;
  console.log(`✓ 完成。exercise_library 现有 ${total} 条（本次跳过无名 ${skipped} 条）。`);
  db.close();
}

main().catch((err) => {
  console.error("种子脚本失败：", err);
  process.exit(1);
});
