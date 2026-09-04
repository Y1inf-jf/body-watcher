import { NextResponse } from "next/server";
import {
  queryHealthMetrics,
  queryMuscleRecovery,
  getRecentTrainings,
  queryBodyComposition,
  queryGoogleDailyMetricsRange,
  queryTrainingHistoryDetailed,
} from "@/lib/db";
import {
  computeRecoveryFeatures,
  computeRecoveryScore,
  type GoogleMetricRow,
  type TrainingLogRow,
} from "@/lib/recovery";
import { computeTrainingStatus, computeSleepNeed } from "@/lib/training-status";

export async function GET() {
  const healthMetrics = queryHealthMetrics(30);
  const muscleRecovery = queryMuscleRecovery();
  const recentTrainings = getRecentTrainings(5);
  const bodyComposition = queryBodyComposition(30);

  // 30 天窗口覆盖 21 天基线池 + 当天，供恢复分计算；35 天训练窗口覆盖 ACWR 慢性池。
  const googleRows = queryGoogleDailyMetricsRange(30) as GoogleMetricRow[];
  const recoveryFeatures = computeRecoveryFeatures(googleRows);
  const recoveryScore = computeRecoveryScore(recoveryFeatures);
  const trainingStatus = computeTrainingStatus(queryTrainingHistoryDetailed(35) as TrainingLogRow[]);
  const sleepNeed = computeSleepNeed(recoveryFeatures.sleep, trainingStatus.yesterdayLoad);

  return NextResponse.json({
    healthMetrics,
    muscleRecovery,
    recentTrainings,
    bodyComposition,
    recovery: { features: recoveryFeatures, score: recoveryScore },
    trainingStatus,
    sleepNeed,
  });
}
