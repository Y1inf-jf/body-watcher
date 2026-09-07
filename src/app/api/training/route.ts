import { NextRequest, NextResponse } from "next/server";
import { insertTrainingLog, queryTrainingHistoryDetailed, getRecentTrainings, queryTrainingCalendar, queryRestDays, getTrainingLog, updateTrainingLog, deleteTrainingLog } from "@/lib/db";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { date, duration, rpe, notes, exercises } = body;
  // 从计划卡"执行"进来时带 planId:回链训练记录并把该计划的建议自动销账(见 insertTrainingLog)。
  const planId = Number(body.planId);
  const plan_id = Number.isInteger(planId) && planId > 0 ? planId : null;

  if (!date || !exercises?.length) {
    return NextResponse.json({ error: "date and exercises are required" }, { status: 400 });
  }
  if (!DATE_RE.test(String(date))) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const total_volume = exercises.reduce(
    (sum: number, ex: { sets?: number; reps?: number; weight?: number }) =>
      sum + (ex.sets || 0) * (ex.reps || 0) * (ex.weight || 0),
    0
  );

  const logId = insertTrainingLog(
    { date, duration: duration || null, total_volume, rpe: rpe || null, notes: notes || null, plan_id },
    exercises
  );

  return NextResponse.json({ ok: true, id: logId });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { id, date, duration, rpe, notes, exercises } = body;

  if (!id || !date || !exercises?.length) {
    return NextResponse.json({ error: "id, date and exercises are required" }, { status: 400 });
  }
  if (!DATE_RE.test(String(date))) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const total_volume = exercises.reduce(
    (sum: number, ex: { sets?: number; reps?: number; weight?: number }) =>
      sum + (ex.sets || 0) * (ex.reps || 0) * (ex.weight || 0),
    0
  );

  updateTrainingLog(id, { date, duration: duration || null, total_volume, rpe: rpe || null, notes: notes || null }, exercises);
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
