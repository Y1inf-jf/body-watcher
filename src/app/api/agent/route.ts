import {
  createCoachStream,
  consolidateCoachNotes,
  createSummaryStream,
  createMonthlyStream,
} from "@/lib/agent";
import { createChatSession, insertChatMessage, savePeriodReport } from "@/lib/db";
import { localToday, localDaysAgo } from "@/lib/recovery";
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

// 包装流:文本原样透传给前端,同时累积助手回复;流正常结束或被取消后触发回调
// (cancelled 标记区分两者)。用于在对话结束后触发后台记忆整理(不 await,不阻塞响应)。
function withStreamTap(
  stream: ReadableStream<Uint8Array>,
  onDone: (assistantText: string, cancelled: boolean) => void
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let cancelled = false;
  const finish = () => {
    try {
      onDone(text, cancelled);
    } catch {
      // 回调自身的错误不能影响响应
    }
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        finish();
        return;
      }
      text += decoder.decode(value, { stream: true });
      controller.enqueue(value);
    },
    async cancel(reason) {
      cancelled = true;
      finish();
      return reader.cancel(reason);
    },
  });
}

export async function POST(req: NextRequest) {
  const mode = new URL(req.url).searchParams.get("mode");

  // 请求体可带对话历史(多轮追问)与 sessionId;旧的无 body 调用视为单轮。
  let history: ModelMessage[] | null = null;
  let sessionId: number | null = null;
  try {
    const body = await req.json();
    history = sanitizeMessages(body?.messages);
    const sid = Number(body?.sessionId);
    sessionId = Number.isInteger(sid) && sid > 0 ? sid : null;
  } catch {
    // 无 body 或非 JSON → 单轮模式
  }

  let stream: ReadableStream<Uint8Array>;
  // 本轮落库归属的会话 id,经响应头 X-Chat-Session 回传(前端首发新会话时据此同步)。
  let persistSessionId: number | null = null;
  try {
    if (mode === "summary") {
      stream = await createSummaryStream(req.signal);
    } else if (mode === "monthly") {
      // 阶段复盘:流式输出,正常结束(或取消)后把全文落库,报告 Tab 可回看。
      const monthly = await createMonthlyStream(req.signal);
      stream = withStreamTap(monthly, (text, cancelled) => {
        // 取消只存半截报告,宁可不落库让用户重新生成;
        // agentLoop 对无输出/中途失败会写入"[生成失败：…]"兜底——那是错误不是报告,同样不落库。
        if (cancelled || !text.trim() || text.includes("[生成失败")) return;
        try {
          savePeriodReport("monthly", localDaysAgo(29), localToday(), text);
        } catch (e) {
          console.warn("[monthly-report] persist failed:", (e as Error).message);
        }
      });
    } else if (history) {
      // 对话首轮先同步一次设备数据,保证分析基于昨晚最新数据;追问轮不再重复同步。
      if (history.length === 1) await runSync().catch(() => {});
      const coachStream = await createCoachStream(history, req.signal);
      // 流结束后异步做两件事:持久化本轮问答到会话(前端刷新可恢复),整理长期记忆。
      // 客户端每轮都带全量历史,这里只落库最后一条 user + 新回复,避免重复。
      // 前端没带有效 sessionId(新对话首发)时服务端就地建会话,标题由首条用户消息生成。
      persistSessionId = sessionId ?? createChatSession().id;
      const lastUser = [...history].reverse().find((m) => m.role === "user");
      const lastUserText = lastUser && typeof lastUser.content === "string" ? lastUser.content : "";
      stream = withStreamTap(coachStream, (reply) => {
        if (!reply.trim()) return;
        try {
          if (lastUserText) insertChatMessage(persistSessionId!, "user", lastUserText);
          insertChatMessage(persistSessionId!, "assistant", reply);
        } catch (e) {
          console.warn("[chat] persist failed:", (e as Error).message);
        }
        consolidateCoachNotes([...history, { role: "assistant", content: reply }]).catch((e) =>
          console.warn("[coach-notes] consolidation failed:", (e as Error).message)
        );
      });
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
      ...(persistSessionId ? { "X-Chat-Session": String(persistSessionId) } : {}),
    },
  });
}
