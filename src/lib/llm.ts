import { streamText, stepCountIs, type StopCondition, type ToolSet } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

const BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const API_KEY = process.env.DEEPSEEK_API_KEY || "";
const MODEL = process.env.LLM_MODEL || "mimo-v2.5-pro";

/**
 * 基于 Vercel AI SDK v6 的 agent 流。
 *
 * 相比旧的手写 fetch 循环，这里获得：
 * - tool 参数经 Zod 校验后才进入 execute（inputSchema）
 * - 内建重试（maxRetries=2）与超时（timeout）
 * - abortSignal 透传到上游，客户端取消时真正中断上游请求
 * - 上游错误由 SDK 抛出，路由可映射为正确 HTTP 状态（见 /api/agent）
 */
// 工具集合类型：直接复用 AI SDK 的 ToolSet，工具定义在 agent.ts 用 tool() + Zod 构建。
export type AgentTools = ToolSet;

export function getProvider() {
  if (!API_KEY) {
    throw new Error("DEEPSEEK_API_KEY is not configured");
  }
  // 必须用 .chat() 走 Chat Completions：DeepSeek 等 OpenAI 兼容服务不实现 Responses API。
  // 非官方模型名（如 mimo-v2.5-pro）不在 OpenAIChatModelId 联合类型里，需断言。
  return createOpenAI({
    baseURL: BASE_URL,
    apiKey: API_KEY,
    name: "deepseek",
  }).chat(MODEL as Parameters<ReturnType<typeof createOpenAI>["chat"]>[0]);
}

/**
 * 运行 agent 循环并以纯文本流返回（仅文字 delta，工具调用过程不在流中）。
 * 前端用 `prev + chunk` 拼接即可，无需解析 SSE。
 *
 * @param extraStopConditions 额外停止条件，与 stepCountIs(maxSteps) 合并。
 *   例如 agent 模式传入 hasToolCall("save_training_plan")，保存即停，
 *   防止模型在单次循环内重复写库。
 */
export function agentLoop(
  systemPrompt: string,
  userPrompt: string,
  tools: AgentTools,
  maxSteps: number,
  extraStopConditions: StopCondition<ToolSet>[] = []
): ReadableStream<Uint8Array> {
  const model = getProvider();

  const result = streamText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    tools,
    // v6 用 stopWhen 取代 maxSteps；默认 stepCountIs(1) 不会循环，必须显式设置。
    stopWhen: [stepCountIs(maxSteps), ...extraStopConditions],
    maxRetries: 2,
    timeout: { totalMs: 60_000 },
  });

  // toTextStreamResponse 返回 web Response；取其 body 作为 ReadableStream。
  return result.toTextStreamResponse().body as ReadableStream<Uint8Array>;
}
