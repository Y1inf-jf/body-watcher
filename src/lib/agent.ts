import { tool, generateText, type ModelMessage } from "ai";
import { z } from "zod";
import { agentLoop, getProvider, type AgentTools } from "./llm";
import {
  queryHealthMetrics,
  queryTrainingHistoryDetailed,
  queryMuscleRecovery,
  queryBodyComposition,
  queryGoogleDailyMetricsRange,
  saveTrainingPlan,
  getCoachNotes,
  getActiveCoachNotes,
  applyCoachNoteOps,
  type CoachNoteOp,
} from "./db";
import {
  computeRecoveryFeatures,
  computeRecoveryScore,
  localToday,
  localDaysAgo,
  summarizeTrainingLoad,
  type GoogleMetricRow,
  type TrainingLogRow,
} from "./recovery";
import { computeTrainingStatus, computeSleepNeed } from "./training-status";

// 长期笔记注入:每次对话都带上(已过滤过期笔记),这是"根据个人情况修正"的落点。
// 记忆的写入不在对话热路径做——对话流结束后由 consolidateCoachNotes 异步整理进库。
function buildCoachSystemPrompt(): string {
  const notes = getActiveCoachNotes();
  const notesBlock =
    notes.length > 0
      ? notes
          .map(
            (n) =>
              `- #${n.id}${n.pinned ? " [硬约束]" : ""} ${n.content}（${n.created_at}${n.source === "user" ? "，用户手动添加" : ""}${n.expires_at ? `，有效期至 ${n.expires_at}` : ""}）`
          )
          .join("\n")
      : "暂无";

  return `你是一位专业的力量训练教练和运动科学顾问，通过多轮对话为用户提供恢复分析和训练计划。

今天是 ${localToday()}。所有涉及具体日期的字段（如 save_training_plan 的 date / plan_date）一律以今天为基准推算，不要猜测日期。

## 用户个人情况（长期笔记，每次对话都生效，必须遵守；[硬约束] 为绝对限制；笔记之间冲突时，以编号较大（较新）的为准）

${notesBlock}

## 重要规则

- 工具返回的数据就是用户的实际数据，直接使用即可，不要说"数据不可用"或"无法获取"
- 如果某个工具返回空数组，说明用户还没有该类型的数据，此时基于已有数据进行分析
- 不要反复调用同一个工具，调用一次即可
- 用户对分析或计划提出异议时（如体感不符、想换动作、时间不够），认真对待：必要时重新查询数据，然后直接给出修正后的结论
- 修改训练计划后必须重新调用 save_training_plan 保存新版本；一次回复里只保存一次，不要连环保存
- 对话中获知**持久的**个人情况（伤病史、恢复快慢的规律、器材/时间限制、动作偏好、主观感受模式）时，在回复里自然地确认你会记住（如"了解，后续计划会避开深蹲"）；笔记的保存与修订由系统在对话结束后自动完成，不要声称"已保存/已更新笔记"这类工具性表述；当天性的临时信息（如"今天没时间"）无需确认记忆
- 你的判断与某条长期笔记矛盾时（如用户刚说伤病已愈、笔记还是旧伤），以用户最新表述为准给出建议，不必纠结旧笔记——系统会自动修订它

## 核心原则

1. **渐进超负荷**：训练量应随时间逐步增加，但不盲目加量
2. **肌群恢复**：力量训练后肌群需要 48-72 小时恢复，间隔不足则跳过该肌群（用户笔记另有说明时以笔记为准）
3. **HRV 信号**：可穿戴设备的 HRV rMSSD z-score ≤ -1，或较基线下降超过 10%，提示身体压力较大，应降低训练强度；基线未就绪时按原始值趋势判断
4. **恢复分**：query_recovery_status 会返回综合恢复分（0-100，50=自己的正常水平）。红色（<34）当天只安排轻松恢复活动；黄色（34-66）正常训练但不冲 PR；绿色（>=67）可上强度。分数为 null 时按 HRV/静息心率/睡眠分项信号判断，并说明基线累计进度
5. **训练状态**：query_recovery_status 返回 trainingStatus——ACWR 急慢性比（<0.8 欠训练可加量；0.8-1.3 最优区间维持；1.3-1.5 偏高不再加量；>1.5 急性峰值，只做轻松恢复）、form 体力-疲劳（>+5 新鲜可冲；-10~+5 平衡；<-10 疲劳积累应减量）、周负荷/单调性（单调性>2 说明训练内容太单一，建议变换）、睡眠需求推荐。负荷可能由估计 RPE 得出（estimatedSessions>0 时提醒用户在训记里填 RPE 更准）
6. **静息心率**：静息心率较基线升高 5bpm 以上提示恢复不足
7. **睡眠**：在床时长不足 6 小时、睡眠负债超过 45 分钟、或深睡占比低于 15% 时，避免大重量训练
8. **RPE**：主观疲劳感高（>7）时，选择恢复性训练或休息
9. **数据优先级**：可穿戴设备数据（query_recovery_status）与手工录入数据并存时，以设备值为准，手工数据作补充
10. **用户体感优先**：用户对自己身体的当下描述（疼痛、酸胀、精神状态）是第一手信号，与数据结论冲突时明确指出分歧，并以用户体感为准调整建议

## 工作流程

- **恢复分析类请求**：先调用 query_recovery_status 获取恢复分、设备信号与训练负荷，需要时补充肌群恢复查询；输出结构：今日恢复分与色带 → 昨晚睡眠 → 自主神经信号 → 训练负荷状态 → 今日建议（强度定位、练什么、1-2 条注意点）
- **排课请求**：query_recovery_status → 查询各肌群恢复状态与近期训练历史 → 综合分析后生成训练计划，调用 save_training_plan 保存

## 计划保存格式

save_training_plan 包含：
- date：生成日期（YYYY-MM-DD）
- plan_date：计划目标日期（可选）
- analysis_summary：综合分析（2-3句话）
- recovery_assessment：恢复状态评估
- exercises：动作列表 JSON 字符串（每项包含 name、muscle_group、sets、reps、weight）
- advice：注意事项和建议

保存动作只做一次；保存完成后，用 3-6 句话总结本次计划的恢复判断与训练重点，作为最终回复。

请使用中文回复，分析类输出用小标题分段。`;
}

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
      // 35 天训练窗口覆盖 ACWR 的 28 天慢性池；近 7 天汇总从同一份结果本地切片,
      // 避免再发一次 N+1 查询且与 trainingStatus 的周窗口口径一致。
      const logs = queryTrainingHistoryDetailed(35) as TrainingLogRow[];
      const trainingStatus = computeTrainingStatus(logs);
      return {
        recovery,
        recoveryScore: computeRecoveryScore(recovery),
        trainingStatus,
        sleepNeed: computeSleepNeed(recovery.sleep, trainingStatus.yesterdayLoad),
        training: summarizeTrainingLoad(logs.filter((l) => l.date >= localDaysAgo(6))),
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

// 教练对话入口:/plan 页多轮对话,首次可以是恢复分析或排课请求,后续自由追问。
export function createCoachStream(messages: ModelMessage[], signal?: AbortSignal) {
  return agentLoop(buildCoachSystemPrompt(), messages, agentTools, 6, { signal });
}

// --- 后台记忆整理:对话流结束后运行,把本轮对话合并进长期笔记 ---
// Mem0 式管线:一次看到全量笔记 + 整段对话,输出 ADD/UPDATE/DELETE 操作,事务套用。
// 相比对话中逐条调工具:无延迟开销、去重与矛盾修正是代码保证而非提示词约定。

const CONSOLIDATE_SYSTEM = `你是健身教练系统的长期记忆整理器。根据一段对话，维护用户的教练笔记。只输出一个 JSON 数组，不要输出任何其他文字或代码块标记。

可用操作（pinned / expires_at 可省略）：
- {"op":"add","content":"一句话笔记","pinned":false,"expires_at":"YYYY-MM-DD"}
- {"op":"update","id":12,"content":"...","pinned":false,"expires_at":"YYYY-MM-DD"}
- {"op":"delete","id":12}
update 里 expires_at 传 null 表示清除到期日。

规则：
- 只维护跨会话持久的个人情况：伤病史、恢复快慢的规律、器材/时间限制、动作偏好、体感模式
- 当天性临时信息（如"今天没时间""今天很累"）忽略；计划的具体动作安排、与个人情况无关的闲聊不产生操作
- 有明确时效的信息（如"未来两周出差只有哑铃"）→ add 或 update 并设置 expires_at，按对话中给出的时间换算具体日期
- 疾病、忌口、疼痛等硬约束 → pinned 为 true
- 对话内容与现有笔记矛盾（伤病痊愈、器材或偏好变化）→ update 旧笔记；确实作废的 delete；不要让矛盾笔记并存
- 与现有笔记重复或高度相似的内容 → 合并为一次 update，不要重复 add
- content 为一句话，不超过 300 字；宁缺毋滥，最多 8 条操作；没有任何要改的输出 []`;

export async function consolidateCoachNotes(messages: ModelMessage[]): Promise<void> {
  if (messages.length === 0) return;
  const notes = getCoachNotes();
  const notesText =
    notes.length > 0
      ? notes
          .map(
            (n) =>
              `- #${n.id}${n.pinned ? " [硬约束]" : ""} ${n.content}${n.expires_at ? `（有效期至 ${n.expires_at}）` : ""}`
          )
          .join("\n")
      : "暂无";
  const transcript = messages
    .map(
      (m) =>
        `${m.role === "user" ? "用户" : "教练"}：${typeof m.content === "string" ? m.content.slice(0, 2000) : ""}`
    )
    .join("\n");

  const { text } = await generateText({
    model: getProvider(),
    system: CONSOLIDATE_SYSTEM,
    prompt: `今天是 ${localToday()}。\n\n现有笔记：\n${notesText}\n\n对话记录：\n${transcript}`,
    maxRetries: 2,
  });

  // 容错解析:取文本中最外层的 JSON 数组(LLM 偶尔会带说明文字或代码块标记)。
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    console.warn("[coach-notes] consolidation output is not valid JSON, skipped");
    return;
  }
  if (!Array.isArray(parsed)) return;

  const opSchema = z.union([
    z.object({
      op: z.literal("add"),
      content: z.string().min(2).max(300),
      pinned: z.boolean().optional(),
      expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    }),
    z.object({
      op: z.literal("update"),
      id: z.number().int().positive(),
      content: z.string().min(2).max(300).optional(),
      pinned: z.boolean().optional(),
      expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    }),
    z.object({ op: z.literal("delete"), id: z.number().int().positive() }),
  ]);
  const result = z.array(opSchema).safeParse(parsed);
  if (!result.success) {
    console.warn("[coach-notes] consolidation ops failed schema validation, skipped");
    return;
  }
  const ops = result.data.slice(0, 10) as CoachNoteOp[];
  if (ops.length > 0) {
    const r = applyCoachNoteOps(ops);
    console.log(`[coach-notes] consolidated: +${r.added} ~${r.updated} -${r.deleted}`);
  }
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

export function createSummaryStream(signal?: AbortSignal) {
  // 周总结不写库：从工具集剔除保存类工具。
  const summaryTools = Object.fromEntries(
    Object.entries(agentTools).filter(([name]) => name !== "save_training_plan")
  );
  return agentLoop(
    SUMMARY_PROMPT,
    [{ role: "user", content: `今天是 ${localToday()}，请总结我最近 7 天的训练情况。` }],
    summaryTools,
    4,
    { signal }
  );
}
