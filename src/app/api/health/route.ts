import { NextRequest, NextResponse } from "next/server";
import { upsertHealth, queryHealthMetrics, getLatestHealth } from "@/lib/db";

// 与旧 any 行为等价的宽松取值:数字/数字字符串收进来,其余(含空串)置 null。
const numLoose = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const date = body.date;

  // 日期是一切窗口查询的主键口径,格式错了会静默掉出所有统计,必须挡在门外。
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  // rest_day 收紧成 0/1:better-sqlite3 对 JS 布尔值直接抛错,日历组件传的是数字 1。
  const restDayRaw = body.rest_day;
  const rest_day = restDayRaw == null ? null : restDayRaw ? 1 : 0;

  upsertHealth({
    date: String(date),
    hrv: numLoose(body.hrv),
    resting_hr: numLoose(body.resting_hr),
    systolic: numLoose(body.systolic),
    diastolic: numLoose(body.diastolic),
    sleep_hours: numLoose(body.sleep_hours),
    sleep_quality: numLoose(body.sleep_quality),
    weight: numLoose(body.weight),
    body_fat: numLoose(body.body_fat),
    rpe: numLoose(body.rpe),
    notes: strOrNull(body.notes),
    rest_day,
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
