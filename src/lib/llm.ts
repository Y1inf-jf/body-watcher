import { streamText, stepCountIs, generateText, type ModelMessage, type StopCondition, type ToolSet } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { getLlmSettings } from "./db";

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_MODEL = "qwen3.8-flash";

type LlmDbVals = { model: string | null; baseUrl: string | null; apiKey: string | null };
// 结构上接受 process.env 与测试用对象字面量
type LlmEnvVals = Record<string, string | undefined>;

// 纯合并逻辑(可单测):每项 DB 设置 > .env > 内置默认。
export function resolveLlmFrom(db: LlmDbVals, env: LlmEnvVals) {
  const src = (dbVal: string | null, envVal: string | undefined) =>
    dbVal ? ("db" as const) : envVal ? ("env" as const) : ("default" as const);
  return {
    baseUrl: db.baseUrl || env.LLM_BASE_URL || DEFAULT_BASE_URL,
    apiKey: db.apiKey || env.LLM_API_KEY || "",
    model: db.model || env.LLM_MODEL || DEFAULT_MODEL,
    source: {
      model: src(db.model, env.LLM_MODEL),
      baseUrl: src(db.baseUrl, env.LLM_BASE_URL),
      apiKey: db.apiKey ? ("db" as const) : env.LLM_API_KEY ? ("env" as const) : ("none" as const),
    },
  };
}

// 配置解析:每次调用现读 better-sqlite3(微秒级),换 Key/模型无需重启服务。
export function resolveLlmConfig() {
  return resolveLlmFrom(getLlmSettings(), process.env);
}

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
  const { baseUrl, apiKey, model } = resolveLlmConfig();
  if (!apiKey) {
    throw new Error("LLM_API_KEY is not configured");
  }
  // 必须用 .chat() 走 Chat Completions：百炼兼容模式等 OpenAI 兼容服务不实现 Responses API。
  // 非官方模型名（如 qwen3.8-flash）不在 OpenAIChatModelId 联合类型里，需断言。
  return createOpenAI({
    baseURL: baseUrl,
    apiKey,
    name: "bailian",
  }).chat(model as Parameters<ReturnType<typeof createOpenAI>["chat"]>[0]);
}

// 连通性测试:用当前生效配置发一条极短生成,"测试"按钮专用。
// 失败原样带回错误文本(401/超时/模型名错都能一眼看出)。
export async function testLlmConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const { text } = await generateText({
      model: getProvider(),
      prompt: "回复两个字:收到",
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(20000),
    });
    return { ok: true, message: text.trim().slice(0, 50) || "(空回复)" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
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
