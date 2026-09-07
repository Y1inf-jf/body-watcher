import { NextRequest, NextResponse } from "next/server";
import { getTrainingPlans, deleteTrainingPlan, saveTrainingPlan } from "@/lib/db";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  const plans = getTrainingPlans(20);
  return NextResponse.json({ plans });
}

// 手动录入自己的训练计划(不产生建议闭环存档——那是 AI 建议的领地)。
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const date = typeof body.date === "string" ? body.date : "";
  const planDate = typeof body.plan_date === "string" && body.plan_date ? body.plan_date : undefined;
  if (!DATE_RE.test(date) || (planDate !== undefined && !DATE_RE.test(planDate))) {
    return NextResponse.json({ error: "date 需为 YYYY-MM-DD" }, { status: 400 });
  }

  const rawExercises = body.exercises;
  if (!Array.isArray(rawExercises) || rawExercises.length === 0) {
    return NextResponse.json({ error: "至少要有一个动作" }, { status: 400 });
  }
  const exercises: { name: string; muscle_group: string; sets: number; reps: number; weight: number | null }[] = [];
  for (const e of rawExercises as Record<string, unknown>[]) {
    const name = typeof e.name === "string" ? e.name.trim() : "";
    const muscle = typeof e.muscle_group === "string" ? e.muscle_group.trim() : "";
    const sets = Number(e.sets);
    const reps = Number(e.reps);
    const weight = e.weight === null || e.weight === undefined || e.weight === "" ? null : Number(e.weight);
    if (!name || name.length > 60) return NextResponse.json({ error: "动作名必填且不超过 60 字" }, { status: 400 });
    if (!muscle || muscle.length > 20) return NextResponse.json({ error: "肌群必填且不超过 20 字" }, { status: 400 });
    if (!Number.isInteger(sets) || sets < 1 || sets > 20) return NextResponse.json({ error: "组数需为 1-20 的整数" }, { status: 400 });
    if (!Number.isInteger(reps) || reps < 1 || reps > 100) return NextResponse.json({ error: "次数需为 1-100 的整数" }, { status: 400 });
    if (weight !== null && (!Number.isFinite(weight) || weight < 0 || weight > 1000)) {
      return NextResponse.json({ error: "重量需为 0-1000 的数字(自重留空)" }, { status: 400 });
    }
    exercises.push({ name, muscle_group: muscle, sets, reps, weight });
  }

  const text = (v: unknown, max: number): string | undefined => {
    if (v === undefined || v === null || v === "") return "";
    if (typeof v !== "string") return undefined;
    const s = v.trim();
    return s.length <= max ? s : undefined;
  };
  const summary = text(body.analysis_summary, 500);
  const advice = text(body.advice, 500);
  if (summary === undefined || advice === undefined) {
    return NextResponse.json({ error: "备注/注意事项不超过 500 字" }, { status: 400 });
  }

  const id = saveTrainingPlan({
    date,
    ...(planDate ? { plan_date: planDate } : {}),
    analysis_summary: summary,
    recovery_assessment: "",
    exercises: JSON.stringify(exercises),
    advice,
  });
  return NextResponse.json({ ok: true, id });
}

export async function DELETE(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  deleteTrainingPlan(id);
  return NextResponse.json({ ok: true });
}
