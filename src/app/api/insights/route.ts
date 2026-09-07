import { NextRequest, NextResponse } from "next/server";
import { dismissInsight } from "@/lib/db";

// 洞察横幅"知道了":dismissed 后当天该规则不再出现(次日条件仍在会重新点火)。
export async function DELETE(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  dismissInsight(id);
  return NextResponse.json({ ok: true });
}
