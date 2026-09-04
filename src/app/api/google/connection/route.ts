import { NextResponse } from "next/server";
import { deleteGoogleTokens } from "@/lib/db";

// 断开连接：清掉本地 token。Google 侧的授权可在账号设置里撤销。
export async function DELETE() {
  deleteGoogleTokens();
  return NextResponse.json({ ok: true });
}
