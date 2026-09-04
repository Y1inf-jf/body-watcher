import { NextResponse } from "next/server";
import { runSync } from "@/lib/google/sync";

// 手动触发同步。未连接/代理不通等以 error 状态返回，详情在 message 里。
export async function POST() {
  const result = await runSync();
  return NextResponse.json(result, { status: result.status === "error" ? 500 : 200 });
}
