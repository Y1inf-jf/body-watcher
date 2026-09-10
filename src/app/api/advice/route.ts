import { NextRequest, NextResponse } from "next/server";
import { ADVICE_STATUSES, getAdvice, resolveAdvice, type AdviceStatus } from "@/lib/db";
import { computeInsights } from "@/lib/insights";

// 建议反馈回填:总览页快捷条「采纳/部分/未采纳」+ 可选体感 RPE 与一句话。可反复修改。
export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const id = Number(body.id);
  const status = body.status as AdviceStatus;
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (!ADVICE_STATUSES.includes(status)) {
    return NextResponse.json({ error: "status must be followed|partial|skipped" }, { status: 400 });
  }
  const rpe = body.felt_rpe == null ? null : Number(body.felt_rpe);
  if (rpe !== null && (!Number.isInteger(rpe) || rpe < 1 || rpe > 10)) {
    return NextResponse.json({ error: "felt_rpe must be 1-10" }, { status: 400 });
  }
  const notes =
    typeof body.body_notes === "string" && body.body_notes.trim()
      ? body.body_notes.trim().slice(0, 200)
      : null;

  if (!getAdvice(id)) {
    return NextResponse.json({ error: "advice not found" }, { status: 404 });
  }
  resolveAdvice(id, status, rpe, notes);
  // 回填改变了 pending 积压数,重算洞察让「N 条还没回填」横幅的数字当场准确。
  computeInsights();
  return NextResponse.json({ ok: true, advice: getAdvice(id) });
}
