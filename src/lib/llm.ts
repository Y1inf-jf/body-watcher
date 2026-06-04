import { createOpenAI } from "@ai-sdk/openai";

export function getLLM() {
  return createOpenAI({
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    apiKey: process.env.DEEPSEEK_API_KEY,
  });
}

export function getModel() {
  const llm = getLLM();
  return llm("deepseek-chat");
}
