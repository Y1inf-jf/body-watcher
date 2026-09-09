import { NextRequest, NextResponse } from "next/server";
import { getCoachNotes, insertCoachNote, deleteCoachNote, updateCoachNotePinned } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ notes: getCoachNotes() });
}

// 手动添加(source=user):后台整理产生的笔记 source=agent。
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content || content.length > 300) {
    return NextResponse.json({ error: "content required (1-300 chars)" }, { status: 400 });
  }
  const pinned = body?.pinned === 1 || body?.pinned === true;
  const note = insertCoachNote(content, "user", { pinned });
  return NextResponse.json({ ok: true, note });
}

// 置顶/取消置顶:置顶的硬约束笔记(疾病、忌口等)不被 30 条上限挤出。
export async function PATCH(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const id = Number(body?.id);
  const pinned = body?.pinned;
  if (!Number.isInteger(id) || id <= 0 || (pinned !== 0 && pinned !== 1)) {
    return NextResponse.json({ error: "id and pinned (0|1) required" }, { status: 400 });
  }
  updateCoachNotePinned(id, pinned === 1);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  deleteCoachNote(id);
  return NextResponse.json({ ok: true });
}
