import { NextRequest, NextResponse } from "next/server";
import {
  createChatSession,
  listChatSessions,
  getChatMessages,
  deleteChatSession,
} from "@/lib/db";

// 无 sessionId:返回会话列表(按最近更新倒序);带 sessionId:返回该会话最近 60 条消息(时间正序)。
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (sessionId !== null) {
    const id = Number(sessionId);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "invalid sessionId" }, { status: 400 });
    }
    return NextResponse.json({ messages: getChatMessages(id, 60) });
  }
  return NextResponse.json({ sessions: listChatSessions() });
}

// 新建会话(标题留空,首条用户消息落库时自动生成)。
export async function POST() {
  return NextResponse.json({ session: createChatSession() });
}

// 删除会话及其全部消息。
export async function DELETE(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  deleteChatSession(id);
  return NextResponse.json({ ok: true });
}
