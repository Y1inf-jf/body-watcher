import { createAgentStream, createSummaryStream } from "@/lib/agent";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const mode = new URL(req.url).searchParams.get("mode");

  let stream: ReadableStream<Uint8Array>;
  try {
    stream = mode === "summary" ? await createSummaryStream() : await createAgentStream();
  } catch (e) {
    // 同步初始化失败（如 API_KEY 缺失、provider 构造失败）→ 500 JSON。
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // 纯文本流：每个 chunk 为文字 delta，前端用 prev+chunk 拼接。
  // 上游运行时错误（429/超时等）由 AI SDK 在流内处理，客户端侧表现为流提前结束。
  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
