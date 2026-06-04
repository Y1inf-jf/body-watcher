import { NextRequest, NextResponse } from "next/server";
import { upsertHealth, queryHealthMetrics, getLatestHealth } from "@/lib/db";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { date, hrv, resting_hr, systolic, diastolic, sleep_hours, sleep_quality, weight, body_fat, rpe, notes } = body;

  if (!date) {
    return NextResponse.json({ error: "date is required" }, { status: 400 });
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
