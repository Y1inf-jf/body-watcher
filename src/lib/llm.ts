const BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const API_KEY = process.env.DEEPSEEK_API_KEY || "";
const MODEL = process.env.LLM_MODEL || "mimo-v2.5-pro";

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AgentTool {
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export async function agentLoop(
  systemPrompt: string,
  userPrompt: string,
  tools: Record<string, AgentTool>,
  maxSteps: number = 8
): Promise<ReadableStream<Uint8Array>> {
  if (!API_KEY) {
    throw new Error("DEEPSEEK_API_KEY is not configured");
  }

  const encoder = new TextEncoder();
  const toolDefs: ToolDef[] = Object.entries(tools).map(([name, t]) => ({
    type: "function" as const,
    function: { name, description: t.description, parameters: t.parameters },
  }));

  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  let cancelled = false;

  return new ReadableStream({
    async pull(controller) {
      try {
        for (let step = 0; step < maxSteps; step++) {
          if (cancelled) return;

          const res = await fetch(`${BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${API_KEY}`,
            },
            body: JSON.stringify({
              model: MODEL,
              messages,
              tools: toolDefs.length > 0 ? toolDefs : undefined,
            }),
          });

          if (!res.ok) {
            const err = await res.text();
            controller.enqueue(encoder.encode(`API 错误: ${res.status}`));
            controller.close();
            return;
          }

          const json = await res.json();
          const choice = json.choices?.[0];
          const msg = choice?.message;

          if (!msg?.tool_calls?.length) {
            controller.enqueue(encoder.encode(msg?.content || ""));
            controller.close();
            return;
          }

          const toolLog = msg.tool_calls
            .map((tc: { function: { name: string; arguments: string } }) => {
              const args = tc.function.arguments;
              return `[调用工具: ${tc.function.name}(${args.length > 80 ? args.slice(0, 80) + "..." : args})]`;
            })
            .join("\n");
          controller.enqueue(encoder.encode(toolLog + "\n"));

          messages.push({
            role: "assistant",
            content: msg.content || null,
            tool_calls: msg.tool_calls.map(
              (tc: { id: string; type: string; function: { name: string; arguments: string } }) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.function.name, arguments: tc.function.arguments },
              })
            ),
          });

          for (const tc of msg.tool_calls) {
            try {
              const args = JSON.parse(tc.function.arguments);
              const result = await tools[tc.function.name].execute(args);
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: JSON.stringify(result),
              });
            } catch (e) {
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: JSON.stringify({ error: (e as Error).message }),
              });
            }
          }
        }

        controller.enqueue(encoder.encode("已达到最大步骤限制"));
        controller.close();
      } catch (e) {
        try {
          controller.enqueue(encoder.encode(`Agent 错误: ${(e as Error).message}`));
          controller.close();
        } catch { /* stream already closed */ }
      }
    },
    cancel() {
      cancelled = true;
    },
  });
}
