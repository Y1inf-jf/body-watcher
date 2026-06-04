import { streamText, stepCountIs } from "ai";
import { getModel } from "@/lib/llm";
import { SYSTEM_PROMPT, agentTools } from "@/lib/agent";

export async function POST() {
  const model = getModel();
  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    prompt: `今天是 ${new Date().toISOString().split("T")[0]}，请根据我的数据生成下一次训练计划。`,
    tools: agentTools,
    stopWhen: stepCountIs(8),
  });

  return result.toTextStreamResponse();
}
