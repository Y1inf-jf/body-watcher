import { NextResponse } from "next/server";
import { getRecentChatMessages } from "@/lib/db";

// 教练对话历史(最近 limit 条,时间正序)。前端刷新后据此恢复会话。
export async function GET() {
  return NextResponse.json({ messages: getRecentChatMessages(60) });
}
