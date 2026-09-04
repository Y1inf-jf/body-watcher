import { tool } from "ai";
import { z } from "zod";
import { agentLoop, type AgentTools } from "./llm";
import {
  queryHealthMetrics,
  queryTrainingHistoryDetailed,
  queryMuscleRecovery,
  queryBodyComposition,
  queryGoogleDailyMetricsRange,
  saveTrainingPlan,
} from "./db";
import {
  computeRecoveryFeatures,
  computeRecoveryScore,
  summarizeTrainingLoad,
  type GoogleMetricRow,
  type TrainingLogRow,
} from "./recovery";
import { computeTrainingStatus, computeSleepNeed } from "./training-status";

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
3. **HRV 信号**：可穿戴设备的 HRV rMSSD z-score ≤ -1，或较基线下降超过 10%，提示身体压力较大，应降低训练强度；基线未就绪时按原始值趋势判断
4. **恢复分**：query_recovery_status 会返回综合恢复分（0-100，50=自己的正常水平）。红色（<34）当天只安排轻松恢复活动；黄色（34-66）正常训练但不冲 PR；绿色（>=67）可上强度。分数为 null 时按 HRV/静息心率/睡眠分项信号判断，并说明基线累计进度
5. **训练状态**：query_recovery_status 返回 trainingStatus——ACWR 急慢性比（<0.8 欠训练可加量；0.8-1.3 最优区间维持；1.3-1.5 偏高不再加量；>1.5 急性峰值，只做轻松恢复）、form 体力-疲劳（>+5 新鲜可冲；-10~+5 平衡；<-10 疲劳积累应减量）、周负荷/单调性（单调性>2 说明训练内容太单一，建议变换）、睡眠需求推荐。负荷可能由估计 RPE 得出（estimatedSessions>0 时提醒用户在训记里填 RPE 更准）
6. **静息心率**：静息心率较基线升高 5bpm 以上提示恢复不足
7. **睡眠**：在床时长不足 6 小时、睡眠负债超过 45 分钟、或深睡占比低于 15% 时，避免大重量训练
8. **RPE**：主观疲劳感高（>7）时，选择恢复性训练或休息
9. **数据优先级**：可穿戴设备数据（query_recovery_status）与手工录入数据并存时，以设备值为准，手工数据作补充

## 工作流程

1. 先调用 query_recovery_status，获取今日恢复分（红/黄/绿）、设备恢复信号（HRV/静息心率基线偏离、睡眠负债）与近 7 天训练负荷
2. 查询手工健康指标与各肌群恢复状态，确定哪些肌群可以训练
3. 查询近期训练历史，了解训练模式和进步趋势
4. 综合分析后生成训练计划，并调用 save_training_plan 保存

## 输出要求

生成训练计划时请调用 save_training_plan 工具保存，包含：
- analysis_summary：综合分析（2-3句话）
- recovery_assessment：恢复状态评估
- exercises：动作列表 JSON 字符串（每项包含 name、muscle_group、sets、reps、weight）
- advice：注意事项和建议

保存动作只做一次；保存完成后，用 3-6 句话总结本次计划的恢复判断与训练重点，作为最终回复。

请使用中文回复。`;

// 工具集：每个工具的入参经 Zod 校验后才进入 execute，
// 杜绝旧实现里 JSON.parse 后直接喂给 DB 写入的校验缺失问题。
export const agentTools: AgentTools = {
  query_recovery_status: tool({
    description:
      "查询可穿戴设备恢复信号与训练状态：今日恢复分（0-100 及红/黄/绿档位）、HRV/静息心率相对基线的偏离（z-score）、昨晚睡眠各阶段与睡眠负债与今晚睡眠需求推荐、ACWR 急慢性负荷比与训练状态分区、form 体力-疲劳、周负荷/单调性/strain、近 7 天训练负荷汇总、近 14 天设备指标明细",
    inputSchema: z.object({}),
    execute: async () => {
      // 30 天窗口：覆盖 21 天基线池 + 当天；明细只回传最近 14 天控制 payload。
      const rows = queryGoogleDailyMetricsRange(30) as GoogleMetricRow[];
      const recovery = computeRecoveryFeatures(rows);
      // 35 天训练窗口覆盖 ACWR 的 28 天慢性池。
      const trainingStatus = computeTrainingStatus(
        queryTrainingHistoryDetailed(35) as TrainingLogRow[]
      );
      return {
        recovery,
        recoveryScore: computeRecoveryScore(recovery),
        trainingStatus,
        sleepNeed: computeSleepNeed(recovery.sleep, trainingStatus.yesterdayLoad),
        training: summarizeTrainingLoad(queryTrainingHistoryDetailed(7) as TrainingLogRow[]),
        muscleRecovery: queryMuscleRecovery(),
        recent: rows.slice(-14),
      };
    },
  }),
  query_health_metrics: tool({
    description: "查询最近 N 天的健康指标数据（HRV、静息心率、血压、睡眠等）",
    inputSchema: z.object({
      days: z.number().int().positive().max(365).default(7).describe("查询天数"),
    }),
    execute: async ({ days }) => queryHealthMetrics(days),
  }),
  query_training_history: tool({
    description: "查询最近 N 天的训练历史记录",
    inputSchema: z.object({
      days: z.number().int().positive().max(365).default(14).describe("查询天数"),
    }),
    execute: async ({ days }) => queryTrainingHistoryDetailed(days),
  }),
  query_muscle_recovery: tool({
    description: "查询各肌群的恢复状态（上次训练时间、距今天数、7天内累计容量）",
    inputSchema: z.object({}),
    execute: async () => queryMuscleRecovery(),
  }),
  query_body_composition: tool({
    description: "查询体重和体脂变化趋势",
    inputSchema: z.object({
      days: z.number().int().positive().max(365).default(30).describe("查询天数"),
    }),
    execute: async ({ days }) => queryBodyComposition(days),
  }),
  save_training_plan: tool({
    description: "保存生成的训练计划到数据库",
    inputSchema: z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("生成日期 YYYY-MM-DD"),
      plan_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("计划目标日期"),
      analysis_summary: z.string().min(1).describe("综合分析"),
      recovery_assessment: z.string().min(1).describe("恢复状态评估"),
      exercises: z.string().describe("动作列表 JSON 字符串"),
      advice: z.string().describe("注意事项"),
    }),
    execute: async (params) => {
      saveTrainingPlan(params);
      return { ok: true };
    },
  }),
};

export function createAgentStream() {
  const today = new Date().toISOString().split("T")[0];
  return agentLoop(
    SYSTEM_PROMPT,
    `今天是 ${today}，请根据我的数据生成下一次训练计划。`,
    agentTools,
    6
    // 不设 hasToolCall 停止条件：思考型模型（如 qwen3.8）在工具步骤不输出正文，
    // 保存即停会导致整条流 0 字节；改为靠 maxSteps 封顶 + prompt 要求"只保存一次"。
  );
}

const SUMMARY_PROMPT = `你是一位专业的力量训练教练。请根据用户本周的训练和健康数据，生成一份周训练总结。

## 重要规则

- 工具返回的数据就是用户的实际数据，直接使用即可，不要说"数据不可用"
- 如果某个工具返回空数组，说明该周没有该类型的数据
- 恢复趋势优先使用可穿戴设备数据（query_recovery_status 里的 HRV 基线偏离与睡眠负债）

## 总结内容

1. **本周训练概况**：训练了几次、练了哪些肌群、总容量
2. **亮点**：哪些动作有进步（重量/次数提升）
3. **恢复状态**：HRV、睡眠、疲劳感的趋势
4. **改进建议**：下周可以调整的地方

请用简洁清晰的中文回复，不需要调用任何保存工具。`;

export function createSummaryStream() {
  const today = new Date().toISOString().split("T")[0];
  // 周总结不写库：从工具集剔除 save_training_plan。
  const summaryTools = Object.fromEntries(
    Object.entries(agentTools).filter(([name]) => name !== "save_training_plan")
  );
  return agentLoop(
    SUMMARY_PROMPT,
    `今天是 ${today}，请总结我最近 7 天的训练情况。`,
    summaryTools,
    4
  );
}

const RECOVERY_PROMPT = `你是一位专业的运动科学顾问。请基于用户可穿戴设备的恢复信号和近期训练负荷，生成今日恢复分析。

## 重要规则

- 工具返回的数据就是用户的实际数据，直接使用即可，不要说"数据不可用"
- 基线数据不足时（返回里明确标注"基线累计中"），如实说明累计进度，不要编造基线对比
- 这是恢复分析，不是排课：不要生成训练计划明细，不要调用任何保存工具

## 分析结构

1. **今日恢复分**：给出分数与色带（红/黄/绿）及解读，说明分数主要由哪些信号驱动；基线未就绪时说明累计进度
2. **昨晚睡眠**：在床时长、深睡/REM 占比、睡眠负债解读
3. **自主神经信号**：HRV 与静息心率相对基线的偏离（基线未就绪则说明累计进度）
4. **训练负荷状态**：近 7 天训练频次与容量、各肌群恢复情况
5. **今日建议**：今天适合的训练强度、练什么或休息，以及 1-2 条具体注意点

请用简洁的中文回复，用小标题分段。`;

export function createRecoveryStream() {
  const today = new Date().toISOString().split("T")[0];
  // 恢复分析不写库：从工具集剔除 save_training_plan。
  const recoveryTools = Object.fromEntries(
    Object.entries(agentTools).filter(([name]) => name !== "save_training_plan")
  );
  return agentLoop(
    RECOVERY_PROMPT,
    `今天是 ${today}，请分析我今天的恢复情况。`,
    recoveryTools,
    4
  );
}
