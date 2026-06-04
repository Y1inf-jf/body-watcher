import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { getModel } from "./llm";
import {
  queryHealthMetrics,
  queryTrainingHistoryDetailed,
  queryMuscleRecovery,
  queryBodyComposition,
  saveTrainingPlan,
} from "./db";

const SYSTEM_PROMPT = `你是一位专业的力量训练教练和运动科学顾问。

你的任务是根据用户的健康数据和训练历史，生成下一次训练计划。

## 核心原则

1. **渐进超负荷**：训练量应随时间逐步增加，但不盲目加量
2. **肌群恢复**：力量训练后肌群需要 48-72 小时恢复，间隔不足则跳过该肌群
3. **HRV 信号**：HRV 较 baseline 显著下降（>10%）提示身体压力较大，应降低训练强度
4. **静息心率**：静息心率较 baseline 升高 5bpm 以上提示恢复不足
5. **睡眠**：睡眠不足（<6h）或质量差时避免大重量训练
6. **RPE**：主观疲劳感高（>7）时，选择恢复性训练或休息

## 工作流程

1. 先查询用户的健康指标，评估身体状态
2. 查询各肌群恢复状态，确定哪些肌群可以训练
3. 查询近期训练历史，了解训练模式和进步趋势
4. 综合分析后生成训练计划

## 输出要求

生成训练计划时请提供：
- analysis_summary：综合分析（2-3句话，身体状态 + 恢复评估）
- recovery_assessment：恢复状态评估（哪些肌群可以训练，哪些需要继续休息）
- exercises：动作列表（JSON 数组，每项包含 name、muscle_group、sets、reps、weight）
- advice：注意事项和建议

请使用中文回复。`;

const agentTools = {
  query_health_metrics: tool({
    description: "查询最近 N 天的健康指标数据（HRV、静息心率、血压、睡眠等）",
    inputSchema: z.object({ days: z.number().default(7).describe("查询天数") }),
    execute: async ({ days }: { days: number }) => queryHealthMetrics(days),
  }),
  query_training_history: tool({
    description: "查询最近 N 天的训练历史记录",
    inputSchema: z.object({ days: z.number().default(14).describe("查询天数") }),
    execute: async ({ days }: { days: number }) => queryTrainingHistoryDetailed(days),
  }),
  query_muscle_recovery: tool({
    description: "查询各肌群的恢复状态（上次训练时间、距今天数、7天内累计容量）",
    inputSchema: z.object({}),
    execute: async () => queryMuscleRecovery(),
  }),
  query_body_composition: tool({
    description: "查询体重和体脂变化趋势",
    inputSchema: z.object({ days: z.number().default(30).describe("查询天数") }),
    execute: async ({ days }: { days: number }) => queryBodyComposition(days),
  }),
  save_training_plan: tool({
    description: "保存生成的训练计划到数据库",
    inputSchema: z.object({
      date: z.string().describe("生成日期 YYYY-MM-DD"),
      plan_date: z.string().optional().describe("计划目标日期"),
      analysis_summary: z.string().describe("综合分析"),
      recovery_assessment: z.string().describe("恢复状态评估"),
      exercises: z.string().describe("动作列表 JSON 字符串"),
      advice: z.string().describe("注意事项"),
    }),
    execute: async (params: {
      date: string;
      plan_date?: string;
      analysis_summary: string;
      recovery_assessment: string;
      exercises: string;
      advice: string;
    }) => {
      saveTrainingPlan(params);
      return { ok: true };
    },
  }),
};

export async function runAgent() {
  const model = getModel();
  const result = await generateText({
    model,
    system: SYSTEM_PROMPT,
    prompt: `今天是 ${new Date().toISOString().split("T")[0]}，请根据我的数据生成下一次训练计划。`,
    tools: agentTools,
    stopWhen: stepCountIs(8),
  });

  return result;
}

export { SYSTEM_PROMPT, agentTools };
