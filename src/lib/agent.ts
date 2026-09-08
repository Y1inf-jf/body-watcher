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
  savePlanAdvice,
  queryAdviceHistory,
  getUserProfile,
  getRecoverySnapshots,
  getCoachNotes,
  getActiveCoachNotes,
  applyCoachNoteOps,
  getSleepTargets,
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
import { computeReadiness } from "./readiness";
import { mergeManualHealth, latestManualSleepQuality } from "./health-merge";

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

  // 结构化画像:设置页维护的目标与现实约束,排课的量与动作选择以此为硬边界。
  const p = getUserProfile();
  const profileLines: string[] = [];
  if (p.goal.length > 0) profileLines.push(`- 训练目标：${p.goal.join("、")}`);
  if (p.weeklyDaysMin !== null) {
    const days =
      p.weeklyDaysMax !== null && p.weeklyDaysMax !== p.weeklyDaysMin
        ? `${p.weeklyDaysMin}-${p.weeklyDaysMax}`
        : String(p.weeklyDaysMin);
    profileLines.push(`- 每周可训练：${days} 天`);
  }
  if (p.sessionMinMinutes !== null) {
    const minutes =
      p.sessionMaxMinutes !== null && p.sessionMaxMinutes !== p.sessionMinMinutes
        ? `${p.sessionMinMinutes}-${p.sessionMaxMinutes}`
        : String(p.sessionMinMinutes);
    profileLines.push(`- 单次可用时长：约 ${minutes} 分钟`);
  }
  if (p.equipment.trim()) profileLines.push(`- 器材/场地：${p.equipment.trim()}`);
  if (p.schedule.trim()) profileLines.push(`- 作息/时间窗：${p.schedule.trim()}`);
  if (p.diet.trim()) profileLines.push(`- 饮食约束：${p.diet.trim()}`);
  const splitDays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const splitText = (p.weeklySplit ?? [])
    .map((s, i) => (s.trim() ? `${splitDays[i]} ${s.trim()}` : null))
    .filter(Boolean)
    .join("；");
  if (splitText) profileLines.push(`- 每周固定训练安排：${splitText}`);
  const profileBlock =
    profileLines.length > 0
      ? profileLines.join("\n")
      : "未填写。不要替用户假设目标或约束；关键信息缺失且影响结论时，直接问一句";

  return `你是一位专业的力量训练教练和运动科学顾问，通过多轮对话为用户提供恢复分析和训练计划。

今天是 ${localToday()}。所有涉及具体日期的字段（如 save_training_plan 的 date / plan_date）一律以今天为基准推算，不要猜测日期。

## 用户个人情况（长期笔记，每次对话都生效，必须遵守；[硬约束] 为绝对限制；笔记之间冲突时，以编号较大（较新）的为准）

${notesBlock}

## 用户目标与现实约束（结构化档案，设置页维护；排课的训练量、频率与动作选择必须遵守）

${profileBlock}

用户给出了"每周固定训练安排"时，这是他自己跟的计划：分析与排课默认围绕它展开，不要随意重排或替换；只有当恢复/负荷信号明确不支持某天的安排时，才针对那一天给出调整建议并说明数据理由。

## 重要规则

- 工具返回的数据就是用户的实际数据，直接使用即可，不要说"数据不可用"或"无法获取"
- 如果某个工具返回空数组，说明用户还没有该类型的数据，此时基于已有数据进行分析
- **动作与重量必须锚定历史**：排课选动作优先用用户实际练过的动作（query_recovery_status 的 exerciseBaseline 给出每个动作最近一次的组数与最强一组；更早的组间明细用 query_training_history 查）。重量以该动作上次实际表现为基准做渐进超负荷（+2.5%~5% 重量，或同重量 +1~2 次），不要凭空估计。引入用户没练过的新动作必须说明理由（器材限制、避开伤病部位、补短板等）
- 不要反复调用同一个工具，调用一次即可
- 用户对分析或计划提出异议时（如体感不符、想换动作、时间不够），认真对待：必要时重新查询数据，然后直接给出修正后的结论
- 修改训练计划后必须重新调用 save_training_plan 保存新版本；一次回复里只保存一次，不要连环保存
- 对话中获知**持久的**个人情况（伤病史、恢复快慢的规律、器材/时间限制、动作偏好、主观感受模式）时，在回复里自然地确认你会记住（如"了解，后续计划会避开深蹲"）；笔记的保存与修订由系统在对话结束后自动完成，不要声称"已保存/已更新笔记"这类工具性表述；当天性的临时信息（如"今天没时间"）无需确认记忆
- 你的判断与某条长期笔记矛盾时（如用户刚说伤病已愈、笔记还是旧伤），以用户最新表述为准给出建议，不必纠结旧笔记——系统会自动修订它

## 核心原则

1. **渐进超负荷**：训练量应随时间逐步增加，但不盲目加量；增量以 exerciseBaseline/训练历史里该动作的上次实际重量为基准，而非凭空估计
2. **肌群恢复**：力量训练后肌群需要 48-72 小时恢复，间隔不足则跳过该肌群（用户笔记另有说明时以笔记为准）
3. **HRV 信号**：可穿戴设备的 HRV rMSSD z-score ≤ -1，或较基线下降超过 10%，提示身体压力较大，应降低训练强度；基线未就绪时按原始值趋势判断
4. **恢复分**：query_recovery_status 会返回综合恢复分（0-100，50=自己的正常水平）。红色（<34）当天只安排轻松恢复活动；黄色（34-66）正常训练但不冲 PR；绿色（>=67）可上强度。分数为 null 时按 HRV/静息心率/睡眠分项信号判断，并说明基线累计进度
5. **训练状态**：query_recovery_status 返回 trainingStatus——ACWR 急慢性比（<0.8 欠训练可加量；0.8-1.3 最优区间维持；1.3-1.5 偏高不再加量；>1.5 急性峰值，只做轻松恢复）、form 体力-疲劳（>+5 新鲜可冲；-10~+5 平衡；<-10 疲劳积累应减量）、周负荷/单调性（单调性>2 说明训练内容太单一，建议变换）、睡眠需求推荐。负荷可能由估计 RPE 得出（estimatedSessions>0 时提醒用户在训记里填 RPE 更准）
6. **今日建议**：query_recovery_status 返回 readiness——恢复分 × 训练负荷合成的练休结论（可以冲/正常练/主动降档/今天休息），与总览页"今日建议"卡同源。给出"今日建议"时结论与它保持一致；用户体感可以更严格（如"正常练"但用户头疼→降为休息），不要比它更宽松
7. **静息心率**：静息心率较基线升高 5bpm 以上提示恢复不足
8. **睡眠**：在床时长不足 6 小时、睡眠负债超过 45 分钟、或深睡占比低于 15% 时，避免大重量训练。用户设了睡眠目标（recovery.targets：min=债务参照地板、target=今晚建议地板、ideal=建议封顶）时，睡眠债按"目标与历史均值较高者"衡量，引用时说明这个口径
9. **RPE**：主观疲劳感高（>7）时，选择恢复性训练或休息
10. **数据优先级**：可穿戴设备数据（query_recovery_status）与手工录入数据并存时，以设备值为准，手工数据作补充
11. **用户体感优先**：用户对自己身体的当下描述（疼痛、酸胀、精神状态）是第一手信号，与数据结论冲突时明确指出分歧，并以用户体感为准调整建议
12. **闭环校准**：query_advice_history 是你的判断成绩单。给出建议前先对照近期记录：若同类建议反复被跳过（skipped）或用户回填体感与你的判断持续背离（如你判"该降档"但用户回填 followed 且 actual_rpe 不高、恢复反馈良好），说明模型对该用户偏保守，应主动收敛此类建议并在措辞里点明"过去 N 次这类建议你的实际反馈是……"；反之若听劝后恢复改善，则延续。让判断随用户真实反应收敛，而不是一味套通用阈值

## 工作流程

- **恢复分析类请求**：先调用 query_recovery_status 获取恢复分、设备信号与训练负荷，再调用 query_advice_history 查看近期建议与你回填的采纳情况/体感，需要时补充肌群恢复查询；输出结构：今日恢复分与色带 → 昨晚睡眠 → 自主神经信号 → 训练负荷状态 → 今日建议（强度定位、练什么、1-2 条注意点）
- **排课请求**：query_recovery_status（含 exerciseBaseline 动作基线）→ query_advice_history → 需要看组间明细或更早趋势时补 query_training_history（days=30）→ 综合分析后生成训练计划，动作与重量按"锚定历史"规则取值，调用 save_training_plan 保存

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

// 动作基线:排课时动作选择与重量的锚点。从逐组明细聚合,每个动作取
// 最近一次训练的总组数与最强一组(最大重量那组;无负重记自重)。
// 教练据此做渐进超负荷,而不是凭空估计重量、发明没练过的动作。
export interface ExerciseBaselineEntry {
  name: string;
  muscle_group: string;
  last_date: string;
  sets: number;
  top_set: string;
}

export function buildExerciseBaseline(logs: TrainingLogRow[]): ExerciseBaselineEntry[] {
  interface Accum {
    muscle: string;
    lastDate: string;
    rows: { sets: number; reps: number; weight: number; bodyweight: boolean }[];
  }
  const perName = new Map<string, Accum>();
  for (const log of logs) {
    // logs 按 date 倒序:某动作首次出现即最近一次训练,更早的场次不回溯。
    for (const ex of log.exercises ?? []) {
      const name = String(ex.exercise_name ?? "").trim();
      if (!name) continue;
      const row = {
        sets: Number(ex.sets ?? 1) || 1,
        reps: Number(ex.reps ?? 0),
        weight: Number(ex.weight ?? 0),
        bodyweight: ex.bodyweight === 1 || ex.bodyweight === true,
      };
      const cur = perName.get(name);
      if (!cur) {
        perName.set(name, {
          muscle: String(ex.muscle_group ?? "未分类"),
          lastDate: log.date,
          rows: [row],
        });
      } else if (log.date === cur.lastDate) {
        cur.rows.push(row);
      }
    }
  }
  const entries: ExerciseBaselineEntry[] = [];
  for (const [name, a] of perName) {
    const totalSets = a.rows.reduce((s, r) => s + r.sets, 0);
    const loaded = a.rows.filter((r) => r.weight > 0).sort((x, y) => y.weight - x.weight);
    const top = loaded[0] ?? a.rows.slice().sort((x, y) => y.reps - x.reps)[0];
    if (!top) continue;
    const topSet =
      top.weight > 0 ? `${top.reps}次×${top.weight}kg` : top.bodyweight ? `${top.reps}次×自重` : `${top.reps}次`;
    entries.push({
      name,
      muscle_group: a.muscle,
      last_date: a.lastDate,
      sets: totalSets,
      top_set: topSet,
    });
  }
  return entries.sort(
    (x, y) => x.muscle_group.localeCompare(y.muscle_group) || y.last_date.localeCompare(x.last_date)
  );
}

// 工具集：每个工具的入参经 Zod 校验后才进入 execute，
// 杜绝旧实现里 JSON.parse 后直接喂给 DB 写入的校验缺失问题。
export const agentTools: AgentTools = {
  query_recovery_status: tool({
    description:
      "查询可穿戴设备恢复信号与训练状态：今日恢复分（0-100 及红/黄/绿档位）、HRV/静息心率相对基线的偏离（z-score）、昨晚睡眠各阶段与睡眠负债与今晚睡眠需求推荐、ACWR 急慢性负荷比与训练状态分区、form 体力-疲劳、周负荷/单调性/strain、近 7 天训练负荷汇总、各肌群恢复状态、exerciseBaseline（每个动作最近一次的实际组数与最强一组，排课时动作选择与重量的锚点）、近 14 天设备指标明细、readiness（与总览页同源的今日建议合成结论）",
    inputSchema: z.object({}),
    execute: async () => {
      // 30 天窗口：覆盖 21 天基线池 + 当天；明细只回传最近 14 天控制 payload。
      const rows = queryGoogleDailyMetricsRange(30) as GoogleMetricRow[];
      // 与 dashboard 路由同口径：手动录入补缺 + 今日建议合成,避免卡片和教练各说各话。
      const manual = queryHealthMetrics(30) as Record<string, unknown>[];
      const sleepTargets = getSleepTargets();
      const recovery = computeRecoveryFeatures(mergeManualHealth(rows, manual), { sleepTargets });
      // 35 天训练窗口覆盖 ACWR 的 28 天慢性池；近 7 天汇总从同一份结果本地切片,
      // 避免再发一次 N+1 查询且与 trainingStatus 的周窗口口径一致。
      const logs = queryTrainingHistoryDetailed(35) as TrainingLogRow[];
      const trainingStatus = computeTrainingStatus(logs);
      const recoveryScore = computeRecoveryScore(recovery);
      return {
        recovery,
        recoveryScore,
        readiness: computeReadiness(trainingStatus, recoveryScore, {
          manualSleepQuality: latestManualSleepQuality(manual),
        }),
        trainingStatus,
        sleepNeed: computeSleepNeed(recovery.sleep, trainingStatus.yesterdayLoad, sleepTargets),
        training: summarizeTrainingLoad(logs.filter((l) => l.date >= localDaysAgo(6))),
        muscleRecovery: queryMuscleRecovery(),
        // 动作级基线随首次查询直接带回:即使不再调 query_training_history,
        // 排课也能拿到"上次实际重量"这个渐进超负荷的基准。
        exerciseBaseline: buildExerciseBaseline(logs),
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
      const planId = saveTrainingPlan(params);
      // 建议闭环:计划同步存档为一条建议(目标日优先),经"执行"按钮完成训练时自动销账。
      savePlanAdvice(
        planId,
        params.plan_date || params.date,
        params.recovery_assessment,
        params.advice || null
      );
      return { ok: true, plan_id: planId };
    },
  }),
  query_advice_history: tool({
    description:
      "查询近期建议闭环记录:每日建议(daily)与计划建议(plan)的原文、你是否采纳(followed=采纳/partial=部分/skipped=未做/pending=待回填)、你回填的体感 RPE 与一句话(body_notes),以及计划建议是否被实际执行(executed>0 表示练了,附 actual_volume/actual_rpe 实际容量与 RPE,未练则 executed=0)。给出恢复分析或排课前先读它,用你的真实反应校准后续判断",
    inputSchema: z.object({
      days: z.number().int().positive().max(90).default(14).describe("查询最近天数"),
    }),
    execute: async ({ days }) => queryAdviceHistory(days),
  }),
  query_period_review: tool({
    description:
      "查询阶段复盘数据包(默认近 30 天):每日恢复分快照序列(恢复分/睡眠债/ACWR/form/周负荷,随日期升序)、训练记录精简列表(日期/容量/RPE/时长)、体重体脂趋势、建议采纳统计。生成阶段复盘时必调",
    inputSchema: z.object({
      days: z.number().int().positive().max(90).default(30).describe("复盘窗口天数"),
    }),
    execute: async ({ days }) => {
      const snapshots = getRecoverySnapshots(days);
      const logs = queryTrainingHistoryDetailed(days) as TrainingLogRow[];
      const advice = queryAdviceHistory(days);
      const adviceStats = {
        total: advice.length,
        followed: advice.filter((a) => a.status === "followed").length,
        partial: advice.filter((a) => a.status === "partial").length,
        skipped: advice.filter((a) => a.status === "skipped").length,
        pending: advice.filter((a) => a.status === "pending").length,
      };
      return {
        days,
        snapshots,
        training: logs
          .map((l) => ({
            date: l.date,
            duration: l.duration,
            total_volume: l.total_volume as number | null,
            rpe: l.rpe,
          }))
          .reverse(),
        body: queryBodyComposition(days),
        adviceStats,
        advice,
      };
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
- 调用一次 query_advice_history(days=7) 获取本周建议与你的采纳回填，用于第 4 点

## 总结内容

1. **本周训练概况**：训练了几次、练了哪些肌群、总容量
2. **亮点**：哪些动作有进步（重量/次数提升）
3. **恢复状态**：HRV、睡眠、疲劳感的趋势
4. **建议采纳与改进**：本周建议你是否照做了（采纳/部分/未做）、体感如何，据此说下周该往哪个方向调，以及你自己哪类建议该更贴合用户实际反应

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

// --- 阶段复盘(月报):基于恢复快照 + 训练/体成分 + 建议闭环,生成后由 route 落库 ---

const MONTHLY_PROMPT = `你是一位专业的力量训练教练，为用户生成一份阶段复盘（默认近 30 天），帮他看清趋势并定下阶段重点。

## 数据

- 必调一次 query_period_review(days=30)：恢复分快照序列、训练记录、体重体脂、建议采纳统计都在里面
- 恢复分快照从功能上线才开始积累：数量少（<10 天）就少谈恢复趋势，以训练与体成分为主，并注明"恢复趋势样本尚短"
- 必要时补充 query_recovery_status 或 query_advice_history 查细节，不要重复调用

## 复盘结构

1. **训练概况**：总次数、总容量、平均 RPE；前半段 vs 后半段的容量对比说明训练量在涨、平还是退
2. **恢复与负荷**：恢复分均值与最低段、睡眠债反复出现的时段、ACWR 走势——把"练多狠"和"恢复怎样"对上号
3. **体成分**：体重/体脂方向，结合训练目标（画像/笔记）评价是否符合预期
4. **建议采纳**：采纳率与被跳过的建议类型，明确说明你据此对自己的判断口径做了什么修正
5. **下阶段重点**：2-3 条具体可执行（频率/容量/睡眠目标级别），必须与用户的目标和现实约束一致

## 规则

- 工具返回的数据就是事实，引用具体数字，不要说"数据不可用"
- 空数据段如实说明样本不足，不要编造趋势
- 简洁中文，小标题分段；不需要调用任何保存工具`;

export function createMonthlyStream(signal?: AbortSignal) {
  const monthlyTools = Object.fromEntries(
    Object.entries(agentTools).filter(([name]) => name !== "save_training_plan")
  );
  return agentLoop(
    MONTHLY_PROMPT,
    [{ role: "user", content: `今天是 ${localToday()}，请复盘我最近 30 天的训练、恢复与建议执行情况。` }],
    monthlyTools,
    6,
    { signal }
  );
}
