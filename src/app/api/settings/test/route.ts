import { NextResponse } from "next/server";
import { testLlmConnection } from "@/lib/llm";

// 用"当前已保存生效"的 LLM 配置发一条极短生成,供 /settings 测试按钮调用。
// 前端不传任何配置(尤其不传 Key),避免明文 Key 出现在请求体/日志里。
export async function POST() {
  const result = await testLlmConnection();
  return NextResponse.json(result);
}
