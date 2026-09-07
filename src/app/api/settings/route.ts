import { NextRequest, NextResponse } from "next/server";
import { getSleepTargets, setSleepTargets, type SleepTargets } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ sleepTargets: getSleepTargets() });
}

// 三档睡眠目标(min/target/ideal,分钟;null=该档未设)。
// 校验:每档为 [240,720] 的整数或 null;已设的各档需满足 min ≤ target ≤ ideal。
const TARGET_KEYS = ["minMinutes", "targetMinutes", "idealMinutes"] as const;

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const raw = body.sleepTargets;
  if (typeof raw !== "object" || raw === null) {
    return NextResponse.json({ error: "sleepTargets required" }, { status: 400 });
  }
  const values = raw as Record<string, unknown>;
  const parsed = {} as SleepTargets;
  for (const key of TARGET_KEYS) {
    const v = values[key];
    if (v === null) {
      parsed[key] = null;
      continue;
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 240 || n > 720) {
      return NextResponse.json({ error: "每档需要 240-720 的整数分钟数,或留空(null)" }, { status: 400 });
    }
    parsed[key] = n;
  }
  const ordered = TARGET_KEYS.map((k) => parsed[k]).filter((v): v is number => v !== null);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i] < ordered[i - 1]) {
      return NextResponse.json({ error: "三档需满足 最低 ≤ 目标 ≤ 理想" }, { status: 400 });
    }
  }
  setSleepTargets(parsed);
  return NextResponse.json({ ok: true });
}
