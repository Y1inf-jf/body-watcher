import { createAgentStream, createRecoveryStream, createSummaryStream } from "@/lib/agent";
import { runSync } from "@/lib/google/sync";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const mode = new URL(req.url).searchParams.get("mode");

  let stream: ReadableStream<Uint8Array>;
  try {
    if (mode === "recovery") {
      // 晨检前先同步一次设备数据，保证分析基于昨晚最新数据；失败不阻塞（用库中已有数据分析）。
      await runSync().catch(() => {});
      stream = await createRecoveryStream(req.signal);
    } else if (mode === "summary") {
      stream = await createSummaryStream(req.signal);
    } else {
      stream = await createAgentStream(req.signal);
    }
  } catch (e) {
    // 同步初始化失败（如 API_KEY 缺失、provider 构造失败）→ 500 JSON。
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // 纯文本流：每个 chunk 为文字 delta，前端用 prev+chunk 拼接。
  // 上游报错（401/429/超时）会以"[生成失败：...]"文本出现在流尾,不再无声;客户端取消会中止上游。
  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
