import { NextRequest, NextResponse } from "next/server";
import { insertTrainingLog, queryTrainingHistoryDetailed, getRecentTrainings, queryTrainingCalendar, queryRestDays, getTrainingLog, updateTrainingLog, deleteTrainingLog } from "@/lib/db";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 与其他路由同款:坏 JSON 回 400 而非裸 500。
async function readJson(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// 标量宽松取值(与旧 any 行为等价):数字/数字字符串收进来,空串与非有限值置 null。
const numLoose = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

// 动作行规范化:绑 DB 前把松散类型收紧。better-sqlite3 遇 JS 布尔值直接抛错
// (bodyweight: true 会 500),这里统一转 0/1;数字字段非法置 null,名称必填。
function normalizeExercises(raw: unknown): {
  exercise_name: string;
  muscle_group: string;
  sets: number | null;
  reps: number | null;
  weight: number | null;
  bodyweight: number;
  rpe: number | null;
}[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const rows: ReturnType<typeof normalizeExercises> = [];
  for (const e of raw as Record<string, unknown>[]) {
    const name = typeof e.exercise_name === "string" ? e.exercise_name.trim() : "";
    if (!name) return null;
    const muscle = typeof e.muscle_group === "string" ? e.muscle_group.trim() : "";
    const num = (v: unknown): number | null => {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    };
    rows.push({
      exercise_name: name,
      muscle_group: muscle || "未分类",
      sets: num(e.sets),
      reps: num(e.reps),
      weight: num(e.weight),
      bodyweight: e.bodyweight ? 1 : 0,
      rpe: num(e.rpe),
    });
  }
  return rows;
}

export async function POST(request: NextRequest) {
  const body = await readJson(request);
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });
  const { date, duration, rpe, notes } = body;
  // 从计划卡"执行"进来时带 planId:回链训练记录并把该计划的建议自动销账(见 insertTrainingLog)。
  const planId = Number(body.planId);
  const plan_id = Number.isInteger(planId) && planId > 0 ? planId : null;

  const exercises = normalizeExercises(body.exercises);
  if (!date || !exercises) {
    return NextResponse.json({ error: "date and exercises are required" }, { status: 400 });
  }
  if (!DATE_RE.test(String(date))) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const total_volume = exercises.reduce(
    (sum, ex) => sum + (ex.sets || 0) * (ex.reps || 0) * (ex.weight || 0),
    0
  );

  const logId = insertTrainingLog(
    { date: String(date), duration: numLoose(duration), total_volume, rpe: numLoose(rpe), notes: strOrNull(notes), plan_id },
    exercises
  );

  return NextResponse.json({ ok: true, id: logId });
}

export async function PUT(request: NextRequest) {
  const body = await readJson(request);
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });
  const { id, date, duration, rpe, notes } = body;

  const exercises = normalizeExercises(body.exercises);
  if (!id || !date || !exercises) {
    return NextResponse.json({ error: "id, date and exercises are required" }, { status: 400 });
  }
  if (!DATE_RE.test(String(date))) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const total_volume = exercises.reduce(
    (sum, ex) => sum + (ex.sets || 0) * (ex.reps || 0) * (ex.weight || 0),
    0
  );

  updateTrainingLog(Number(id), { date: String(date), duration: numLoose(duration), total_volume, rpe: numLoose(rpe), notes: strOrNull(notes) }, exercises);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get("id") || "");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  deleteTrainingLog(id);
  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "30");
  const recent = searchParams.get("recent");
  const calendar = searchParams.get("calendar");
  const edit = searchParams.get("edit");

  if (edit) {
    const log = getTrainingLog(parseInt(edit));
    if (!log) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ log }, { headers: { "Cache-Control": "no-store" } });
  }

  if (calendar) {
    const now = new Date();
    const year = parseInt(searchParams.get("year") || String(now.getFullYear()));
    const month = parseInt(searchParams.get("month") || String(now.getMonth() + 1));
    const data = queryTrainingCalendar(year, month);
    const restDays = queryRestDays(year, month);
    return NextResponse.json({ calendar: data, restDays, year, month });
  }

  if (recent) {
    const limit = parseInt(recent) || 5;
    const logs = getRecentTrainings(limit);
    return NextResponse.json({ logs });
  }

  const history = queryTrainingHistoryDetailed(days);
  return NextResponse.json({ history });
}
