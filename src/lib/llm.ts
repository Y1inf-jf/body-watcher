import { streamText, stepCountIs, type ModelMessage, type StopCondition, type ToolSet } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

const BASE_URL = process.env.LLM_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";
const API_KEY = process.env.LLM_API_KEY || "";
const MODEL = process.env.LLM_MODEL || "qwen3.8-flash";

/**
 * 基于 Vercel AI SDK v6 的 agent 流。
 *
 * - tool 参数经 Zod 校验后才进入 execute（inputSchema）
 * - 内建重试（maxRetries=2）与超时（timeout.totalMs）
 * - abortSignal 透传上游：客户端取消时真正中断上游请求（后续工具调用不会再执行）
 */
// 工具集合类型：直接复用 AI SDK 的 ToolSet，工具定义在 agent.ts 用 tool() + Zod 构建。
export type AgentTools = ToolSet;

export function getProvider() {
  if (!API_KEY) {
    throw new Error("LLM_API_KEY is not configured");
  }
  // 必须用 .chat() 走 Chat Completions：百炼兼容模式等 OpenAI 兼容服务不实现 Responses API。
  // 非官方模型名（如 qwen3.8-flash）不在 OpenAIChatModelId 联合类型里，需断言。
  return createOpenAI({
    baseURL: BASE_URL,
    apiKey: API_KEY,
    name: "bailian",
  }).chat(MODEL as Parameters<ReturnType<typeof createOpenAI>["chat"]>[0]);
}

export interface AgentLoopOptions {
  signal?: AbortSignal;
  extraStopConditions?: StopCondition<ToolSet>[];
}

/**
 * 运行 agent 循环并以纯文本流返回（仅文字 delta，工具调用过程不在流中）。
 * 前端用 `prev + chunk` 拼接即可，无需解析 SSE。
 *
 * messages 传完整对话历史（含之前的问答），实现多轮追问；单轮场景传一条 user 消息即可。
 *
 * 不使用 toTextStreamResponse：v6 的文本流会把 error 部分静默丢弃，
 * LLM 报错（401/429/超时）在界面上表现为 0 字节"成功"。这里自己消费 textStream——
 * 迭代抛错时把错误信息写进流，前端面板直接可见。
 */
export function agentLoop(
  systemPrompt: string,
  messages: ModelMessage[],
  tools: AgentTools,
  maxSteps: number,
  opts: AgentLoopOptions = {}
): ReadableStream<Uint8Array> {
  const model = getProvider();

  const result = streamText({
    model,
    system: systemPrompt,
    messages,
    tools,
    // v6 用 stopWhen 取代 maxSteps；默认 stepCountIs(1) 不会循环，必须显式设置。
    stopWhen: [stepCountIs(maxSteps), ...(opts.extraStopConditions ?? [])],
    maxRetries: 2,
    abortSignal: opts.signal,
    // 思考型模型带工具循环的单次生成可达 1 分钟以上，60s 会中途截断。
    timeout: { totalMs: 180_000 },
  });

  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const delta of result.textStream) {
          if (opts.signal?.aborted) break;
          controller.enqueue(encoder.encode(delta));
        }
      } catch (err) {
        if (!opts.signal?.aborted) {
          const msg = err instanceof Error ? err.message : String(err);
          try {
            controller.enqueue(encoder.encode(`\n\n[生成失败：${msg}]`));
          } catch {
            // 流已关闭，无从报告
          }
        }
      } finally {
        try {
          controller.close();
        } catch {
          // 已关闭
        }
      }
    },
  });
}
