import { NextResponse } from "next/server";
import { getGoogleTokens, getLastSyncLog, queryGoogleDailyMetrics, queryGoogleRawTypeCounts } from "@/lib/db";
import { isGoogleConfigured } from "@/lib/google/config";

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function GET() {
  const tokens = getGoogleTokens();
  const today = localToday();
  return NextResponse.json({
    configured: isGoogleConfigured(),
    connected: Boolean(tokens?.access_token),
    expiresAt: tokens?.expires_at ?? null,
    lastSync: getLastSyncLog() ?? null,
    todayCounts: queryGoogleRawTypeCounts(today),
    metrics: queryGoogleDailyMetrics(7),
  });
}
