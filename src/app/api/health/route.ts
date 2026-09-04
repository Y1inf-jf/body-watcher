import { NextRequest, NextResponse } from "next/server";
import { upsertHealth, queryHealthMetrics, getLatestHealth } from "@/lib/db";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { date, hrv, resting_hr, systolic, diastolic, sleep_hours, sleep_quality, weight, body_fat, rpe, notes } = body;

  // 日期是一切窗口查询的主键口径,格式错了会静默掉出所有统计,必须挡在门外。
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  upsertHealth({
    date,
    hrv: hrv || null,
    resting_hr: resting_hr || null,
    systolic: systolic || null,
    diastolic: diastolic || null,
    sleep_hours: sleep_hours || null,
    sleep_quality: sleep_quality || null,
    weight: weight || null,
    body_fat: body_fat || null,
    rpe: rpe || null,
    notes: notes || null,
    rest_day: body.rest_day ?? null,
  });

  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "30");

  const metrics = queryHealthMetrics(days);
  const latest = getLatestHealth();

  return NextResponse.json({ metrics, latest });
}
