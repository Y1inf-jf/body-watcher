import { NextRequest, NextResponse } from "next/server";
import { insertTrainingLog, queryTrainingHistoryDetailed, getRecentTrainings } from "@/lib/db";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { date, duration, rpe, notes, exercises } = body;

  if (!date || !exercises?.length) {
    return NextResponse.json({ error: "date and exercises are required" }, { status: 400 });
  }

  const total_volume = exercises.reduce(
    (sum: number, ex: { sets?: number; reps?: number; weight?: number }) =>
      sum + (ex.sets || 0) * (ex.reps || 0) * (ex.weight || 0),
    0
  );

  const logId = insertTrainingLog(
    { date, duration: duration || null, total_volume, rpe: rpe || null, notes: notes || null },
    exercises
  );

  return NextResponse.json({ ok: true, id: logId });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "30");
  const recent = searchParams.get("recent");

  if (recent) {
    const limit = parseInt(recent) || 5;
    const logs = getRecentTrainings(limit);
    return NextResponse.json({ logs });
  }

  const history = queryTrainingHistoryDetailed(days);
  return NextResponse.json({ history });
}
