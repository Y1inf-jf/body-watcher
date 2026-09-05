import { createCoachStream, createSummaryStream } from "@/lib/agent";
import { runSync } from "@/lib/google/sync";
import { NextRequest, NextResponse } from "next/server";
import type { ModelMessage } from "ai";

// 客户端传来的对话历史:只接受纯文本 user/assistant 消息,上限 40 条控制 payload。
function sanitizeMessages(raw: unknown): ModelMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const messages: ModelMessage[] = [];
  for (const m of raw) {
    const role = (m as { role?: unknown })?.role;
    const content = (m as { content?: unknown })?.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string" || content.length === 0) {
      return null;
    }
    messages.push({ role, content });
  }
  return messages.slice(-40);
}

export async function POST(req: NextRequest) {
  const mode = new URL(req.url).searchParams.get("mode");

  // 请求体可带对话历史(多轮追问);旧的无 body 调用视为单轮。
  let history: ModelMessage[] | null = null;
  try {
    const body = await req.json();
    history = sanitizeMessages(body?.messages);
  } catch {
    // 无 body 或非 JSON → 单轮模式
  }

  let stream: ReadableStream<Uint8Array>;
  try {
    if (mode === "summary") {
      stream = await createSummaryStream(req.signal);
    } else if (history) {
      // 对话首轮先同步一次设备数据,保证分析基于昨晚最新数据;追问轮不再重复同步。
      if (history.length === 1) await runSync().catch(() => {});
      stream = await createCoachStream(history, req.signal);
    } else {
      return NextResponse.json({ error: "messages is required" }, { status: 400 });
    }
  } catch (e) {
    // provider 构造失败（如 API_KEY 缺失）→ 500 JSON。
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
