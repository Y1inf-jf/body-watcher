import { NextRequest, NextResponse } from "next/server";
import { getTrainingPlans, deleteTrainingPlan } from "@/lib/db";

export async function GET() {
  const plans = getTrainingPlans(20);
  return NextResponse.json({ plans });
}

export async function DELETE(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  deleteTrainingPlan(id);
  return NextResponse.json({ ok: true });
}
