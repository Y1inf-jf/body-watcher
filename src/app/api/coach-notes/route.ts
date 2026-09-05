import { NextRequest, NextResponse } from "next/server";
import { getCoachNotes, insertCoachNote, deleteCoachNote } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ notes: getCoachNotes() });
}

// 手动添加(source=user):Agent 在对话中保存的笔记 source=agent。
export async function POST(request: NextRequest) {
  const body = await request.json();
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content || content.length > 300) {
    return NextResponse.json({ error: "content required (1-300 chars)" }, { status: 400 });
  }
  const note = insertCoachNote(content, "user");
  return NextResponse.json({ ok: true, note });
}

export async function DELETE(request: NextRequest) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  deleteCoachNote(id);
  return NextResponse.json({ ok: true });
}
