import { NextRequest, NextResponse } from "next/server";
import {
  queryExerciseNames,
  queryLastExerciseSession,
  queryExerciseProgress,
  searchExerciseLibrary,
} from "@/lib/db";

export async function GET(req: NextRequest) {
  const last = req.nextUrl.searchParams.get("last");
  const progress = req.nextUrl.searchParams.get("progress");
  const search = req.nextUrl.searchParams.get("search");

  if (last) {
    const sets = queryLastExerciseSession(last);
    return NextResponse.json({ sets });
  }

  if (progress) {
    const days = parseInt(req.nextUrl.searchParams.get("days") || "90");
    const data = queryExerciseProgress(progress, days);
    return NextResponse.json({ progress: data });
  }

  // 搜索本地缓存的 wger 动作库（未填充库时返回空数组）
  if (search !== null) {
    const results = searchExerciseLibrary(search);
    return NextResponse.json({ results });
  }

  const exercises = queryExerciseNames();
  return NextResponse.json({ exercises });
}
