import { NextResponse } from "next/server";
import { runSync } from "@/lib/google/sync";
import { computeInsights } from "@/lib/insights";

// 手动触发同步。未连接/代理不通等以 error 状态返回，详情在 message 里。
export async function POST() {
  const result = await runSync();
  // 同步后重算洞察:否则手动同步完横幅仍显示旧结论,要等下一次小时级定时器才更新。
  try {
    computeInsights();
  } catch (e) {
    console.warn("[insights] recompute failed:", (e as Error).message);
  }
  return NextResponse.json(result, { status: result.status === "error" ? 500 : 200 });
}
