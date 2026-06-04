import { NextResponse } from "next/server";
import { queryHealthMetrics, queryMuscleRecovery, getRecentTrainings, queryBodyComposition } from "@/lib/db";

export async function GET() {
  const healthMetrics = queryHealthMetrics(30);
  const muscleRecovery = queryMuscleRecovery();
  const recentTrainings = getRecentTrainings(5);
  const bodyComposition = queryBodyComposition(30);

  return NextResponse.json({
    healthMetrics,
    muscleRecovery,
    recentTrainings,
    bodyComposition,
  });
}
