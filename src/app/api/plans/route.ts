import { NextResponse } from "next/server";
import { getTrainingPlans } from "@/lib/db";

export async function GET() {
  const plans = getTrainingPlans(20);
  return NextResponse.json({ plans });
}
