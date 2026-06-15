import { NextResponse } from "next/server";
import { queryTrainingStats } from "@/lib/db";

export async function GET() {
  return NextResponse.json(queryTrainingStats());
}
