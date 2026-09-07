import { NextRequest, NextResponse } from "next/server";
import { listPeriodReports, deletePeriodReport } from "@/lib/db";

// 阶段复盘报告:GET 列表(最新在前,默认 12 份);DELETE 删除。
export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 12);
  const reports = listPeriodReports("monthly", Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 12);
  return NextResponse.json({ reports });
}

export async function DELETE(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  deletePeriodReport(id);
  return NextResponse.json({ ok: true });
}
