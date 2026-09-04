import { NextRequest, NextResponse } from "next/server";
import { getXunjiFetchInfo } from "@/lib/db";
import { isXunjiConfigured, runXunjiSync } from "@/lib/xunji";

// 手动触发训记同步;?days=7&force=1 可扩窗口/忽略已拉取缓存。
export async function POST(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const days = parseInt(params.get("days") || "7");
  const force = params.get("force") === "1";
  const result = await runXunjiSync({ days: Number.isFinite(days) ? days : 7, force });
  return NextResponse.json(result, { status: result.status === "error" ? 500 : 200 });
}

export async function GET() {
  return NextResponse.json({ configured: isXunjiConfigured(), ...getXunjiFetchInfo() });
}
