import { agentLoop, AgentTool } from "./llm";
import {
  queryHealthMetrics,
  queryTrainingHistoryDetailed,
  queryMuscleRecovery,
  queryBodyComposition,
  saveTrainingPlan,
} from "./db";

export const SYSTEM_PROMPT = `你是一位专业的力量训练教练和运动科学顾问。

你的任务是根据用户的健康数据和训练历史，生成下一次训练计划。

## 重要规则

- 工具返回的数据就是用户的实际数据，直接使用即可，不要说"数据不可用"或"无法获取"
- 如果某个工具返回空数组，说明用户还没有该类型的数据，此时基于已有数据进行分析
- 不要反复调用同一个工具，调用一次即可
- 生成计划时必须调用 save_training_plan 工具保存

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
4. 综合分析后生成训练计划，并调用 save_training_plan 保存

## 输出要求

生成训练计划时请调用 save_training_plan 工具保存，包含：
- analysis_summary：综合分析（2-3句话）
- recovery_assessment：恢复状态评估
- exercises：动作列表 JSON 字符串（每项包含 name、muscle_group、sets、reps、weight）
- advice：注意事项和建议

请使用中文回复。`;

export const agentTools: Record<string, AgentTool> = {
  query_health_metrics: {
    description: "查询最近 N 天的健康指标数据（HRV、静息心率、血压、睡眠等）",
    parameters: {
      type: "object",
      properties: {
        days: { type: "number", description: "查询天数", default: 7 },
      },
    },
    execute: async ({ days }) => queryHealthMetrics((days as number) || 7),
  },
  query_training_history: {
    description: "查询最近 N 天的训练历史记录",
    parameters: {
      type: "object",
      properties: {
        days: { type: "number", description: "查询天数", default: 14 },
      },
    },
    execute: async ({ days }) => queryTrainingHistoryDetailed((days as number) || 14),
  },
  query_muscle_recovery: {
    description: "查询各肌群的恢复状态（上次训练时间、距今天数、7天内累计容量）",
    parameters: { type: "object", properties: {} },
    execute: async () => queryMuscleRecovery(),
  },
  query_body_composition: {
    description: "查询体重和体脂变化趋势",
    parameters: {
      type: "object",
      properties: {
        days: { type: "number", description: "查询天数", default: 30 },
      },
    },
    execute: async ({ days }) => queryBodyComposition((days as number) || 30),
  },
  save_training_plan: {
    description: "保存生成的训练计划到数据库",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "生成日期 YYYY-MM-DD" },
        plan_date: { type: "string", description: "计划目标日期" },
        analysis_summary: { type: "string", description: "综合分析" },
        recovery_assessment: { type: "string", description: "恢复状态评估" },
        exercises: { type: "string", description: "动作列表 JSON 字符串" },
        advice: { type: "string", description: "注意事项" },
      },
      required: ["date", "analysis_summary", "recovery_assessment", "exercises", "advice"],
    },
    execute: async (params) => {
      saveTrainingPlan(params as Parameters<typeof saveTrainingPlan>[0]);
      return { ok: true };
    },
  },
};

export function createAgentStream() {
  const today = new Date().toISOString().split("T")[0];
  return agentLoop(
    SYSTEM_PROMPT,
    `今天是 ${today}，请根据我的数据生成下一次训练计划。`,
    agentTools,
    6
  );
}

const SUMMARY_PROMPT = `你是一位专业的力量训练教练。请根据用户本周的训练和健康数据，生成一份周训练总结。

## 重要规则

- 工具返回的数据就是用户的实际数据，直接使用即可，不要说"数据不可用"
- 如果某个工具返回空数组，说明该周没有该类型的数据

## 总结内容

1. **本周训练概况**：训练了几次、练了哪些肌群、总容量
2. **亮点**：哪些动作有进步（重量/次数提升）
3. **恢复状态**：HRV、睡眠、疲劳感的趋势
4. **改进建议**：下周可以调整的地方

请用简洁清晰的中文回复，不需要调用任何保存工具。`;

export function createSummaryStream() {
  const today = new Date().toISOString().split("T")[0];
  const { save_training_plan, ...summaryTools } = agentTools;
  return agentLoop(
    SUMMARY_PROMPT,
    `今天是 ${today}，请总结我最近 7 天的训练情况。`,
    summaryTools,
    4
  );
}
