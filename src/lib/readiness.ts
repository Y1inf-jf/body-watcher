// "今日建议"合成器:把训练状态(练了多少)与恢复信号(身体扛不扛得住)拧成一条行动结论。
// 背景:ACWR"最优区间"只说明负荷节奏合理,对睡眠/HRV 完全无感——两张卡各说各话,
// 用户会读成"系统说我状态好"。这里补上产品层面缺的那一步:恢复决定今天练多重,
// 负荷决定今天该练还是该歇。分区与文档见 docs/training-algorithms.md 第 5 节。
import type { RecoveryScore } from "./recovery";
import type { FormZone, TrainingStatus } from "./training-status";
import type { LoadContext } from "./load-context";

export type ReadinessLevel = "go_hard" | "normal" | "downgrade" | "rest" | "unknown";

export interface Readiness {
  level: ReadinessLevel;
  headline: string; // 一行行动结论
  detail: string; // 依据摘要
  recoveryPart: string | null; // 恢复侧一句话(供卡片"依据"区)
  loadPart: string | null; // 负荷侧一句话
}

// 恢复侧分档:恢复分为骨架;基线未就绪时降级用分项信号 + 手动录入的睡眠自评,
// 只认负向证据(信号差才降档),避免冷启动期把一切误判成"差"。
export type RecoveryBand = "good" | "ok" | "low" | "bad";

interface RecoveryBandResult {
  band: RecoveryBand;
  note: string;
  usedFallback: boolean;
}

// 与恢复分颜色分区对齐:黄区(34–66)卡片文案就是"可正常训练",建议不能跟它唱反调。
// 50 是个人常态,旧门槛 50 会让一半正常日子被判"降档"。黄区只在有异常旗标时降为 low。
export function bandFromScore(score: number, hasFlags: boolean): RecoveryBand {
  if (score < 34) return "bad";
  if (score >= 67) return "good"; // 有旗标时分数封顶 66,到不了这里
  return hasFlags ? "low" : "ok";
}

export function classifyRecoveryBand(recovery: RecoveryScore, manualSleepQuality: number | null): RecoveryBandResult {
  if (recovery.score !== null && recovery.zone !== null) {
    const band = bandFromScore(recovery.score, recovery.flags.length > 0);
    const note =
      band === "bad"
        ? `恢复分 ${recovery.score} 偏低`
        : band === "low"
          ? `恢复分 ${recovery.score}，但有异常信号：${recovery.flags.join("、")}`
          : `恢复分 ${recovery.score} 状态不差`;
    return { band, note, usedFallback: false };
  }

  const reasons: string[] = [];
  const zHrv = recovery.components.hrv.z;
  const zRhr = recovery.components.restingHr.z;
  const zSleep = recovery.components.sleep.z;
  if (zHrv !== null && zHrv <= -1) reasons.push(`HRV 低于基线 ${Math.abs(zHrv).toFixed(1)}σ`);
  if (zRhr !== null && zRhr <= -1) reasons.push("静息心率高于基线"); // restingHr.z 已取负:负值=更高=差
  if (zSleep !== null && zSleep <= -1) reasons.push("睡眠负债大");
  if (manualSleepQuality !== null && manualSleepQuality <= 3) reasons.push(`睡眠自评 ${manualSleepQuality}/10 很差`);
  if (recovery.flags.length > 0) reasons.push(...recovery.flags);

  const band: RecoveryBand = reasons.length === 0 ? "ok" : "low";
  const note = reasons.length === 0 ? "恢复分累计中，未见负向信号" : reasons.join("，");
  return { band, note, usedFallback: true };
}

// 负荷侧分档:ACWR 为主轴,form 与单调性封顶降级。
// ramp = 回归期(停训/生病后):按逐周上限循序加量,永不"可以冲"。
type LoadBand = "build" | "maintain" | "hold" | "deload" | "ramp";

interface LoadBandResult {
  band: LoadBand;
  note: string;
}

const FORM_LABEL: Record<FormZone, string> = { fresh: "新鲜", neutral: "平衡", fatigued: "疲劳积累" };

function acwrZoneLabel(zone: NonNullable<TrainingStatus["acwr"]["zone"]>): string {
  return zone === "under" ? "负荷偏低" : zone === "optimal" ? "最优" : zone === "high" ? "偏高" : "急性峰值";
}

export function classifyLoadBand(
  status: TrainingStatus,
  opts: { loadContext?: LoadContext | null; recoveryBand?: RecoveryBand } = {}
): LoadBandResult {
  // 回归期:ACWR 偏低是应该的,解读交给回归期上限,超上限只提示、不降档。
  // 但护栏不能关掉——ACWR 急性峰值(risk)仍然降档,form 疲劳积累仍然封顶,规则见下方判定。
  const isReturn = opts.loadContext?.phase === "return";
  const { acwr, form, weekly } = status;
  const parts: string[] = [];
  let band: LoadBand = "maintain";
  let underNote: string | null = null;

  if (acwr.zone === null) {
    parts.push("负荷数据累计中");
  } else {
    parts.push(`ACWR ${acwr.value?.toFixed(2)} ${acwrZoneLabel(acwr.zone)}`);
    if (acwr.zone === "risk") band = "deload";
    else if (!isReturn && acwr.zone === "high") band = "hold";
    else if (!isReturn && acwr.zone === "under") {
      // 负荷偏低只在恢复好时才等于"可加量";恢复一般/偏低时低负荷本身是合理的。
      // 老调用方不传 recoveryBand 时保持原行为。
      const rb = opts.recoveryBand;
      if (rb === undefined || rb === "good") band = "build";
      else underNote = rb === "ok" ? "负荷偏少，按计划练" : "低负荷合理，先恢复";
    }
  }
  if (form.zone === "fatigued") {
    parts.push(`form ${form.value}（疲劳积累）`);
    if (band === "build" || band === "maintain") band = "hold";
  } else if (form.zone !== null && (form.zone === "neutral" || form.zone === "fresh")) {
    parts.push(`form ${form.value}（${FORM_LABEL[form.zone]}）`);
  }
  if (weekly.monotonyWarning && weekly.monotony !== null) {
    parts.push(`单调性 ${weekly.monotony.toFixed(1)}（内容太单一）`);
    if (band === "build") band = "maintain";
  }
  // 训记没有 RPE 时,组数和时长只能反映剂量,不能可靠判断接近力竭程度。
  // 保留高负荷预警的保守价值,但不让估算出的"负荷偏低"驱动加量/冲强度。
  if (status.allSessionsEstimated && band === "build") {
    parts.push("负荷由组数和时长估算，不据此加量");
    band = "maintain";
  }

  if (isReturn) {
    if (band === "deload") return { band, note: `${parts.join("，")}——负荷突变，有受伤风险` };
    if (band === "hold") return { band, note: `${parts.join("，")}——不再加量` };
    const loadContext = opts.loadContext as Extract<LoadContext, { phase: "return" }>;
    const acwrSuffix = acwr.zone !== null && acwr.value != null ? `；ACWR ${acwr.value.toFixed(2)} ${acwrZoneLabel(acwr.zone)}` : "";
    return { band: "ramp", note: `${loadContext.note}${acwrSuffix}` };
  }

  const noteMap: Record<LoadBand, string> = {
    build: "相对平时偏少，有加量空间",
    maintain: underNote ?? "负荷节奏健康",
    hold: "不再加量",
    deload: "负荷突变，有受伤风险",
    ramp: "",
  };
  return { band, note: `${parts.join("，")}——${noteMap[band]}` };
}

interface Combo {
  level: ReadinessLevel;
  headline: string;
  detail: string;
}

const COMBOS: Record<RecoveryBand, Record<LoadBand, Combo>> = {
  good: {
    build: { level: "go_hard", headline: "可以冲", detail: "恢复良好且近期偏少，今天适合上强度或补量" },
    maintain: { level: "normal", headline: "正常练", detail: "恢复良好、负荷健康，按计划执行，状态好可小幅加量" },
    hold: { level: "normal", headline: "正常练", detail: "身体扛得住，但负荷已在高位：按计划训练，不再加重" },
    deload: { level: "downgrade", headline: "主动降档", detail: "恢复虽好，但负荷出现急性峰值——今天只做轻松训练，别跟着感觉冲" },
    ramp: { level: "normal", headline: "正常练", detail: "回归期：按本周上限循序加量，不冲极限" },
  },
  ok: {
    build: { level: "normal", headline: "正常练", detail: "恢复不差、近期偏少，按计划训练即可" },
    maintain: { level: "normal", headline: "正常练", detail: "恢复与负荷都在正常带，按计划执行" },
    hold: { level: "downgrade", headline: "主动降档", detail: "负荷偏高，今天练可以，但砍掉最后一两组冲法、别测极限" },
    deload: { level: "rest", headline: "今天休息", detail: "负荷突变叠加恢复一般，继续练只会放大风险" },
    ramp: { level: "normal", headline: "正常练", detail: "回归期：按本周上限循序加量，不冲极限" },
  },
  low: {
    build: { level: "downgrade", headline: "主动降档", detail: "负荷虽有余量，但恢复偏低：今天轻量训练，别急着补量" },
    maintain: { level: "downgrade", headline: "主动降档", detail: "计划没超量，是身体没缓过来：组数减 1/3、重量下 10-20%，睡够优先" },
    hold: { level: "downgrade", headline: "主动降档", detail: "负荷偏高 + 恢复偏低，双重信号：今天只做轻量，观察一晚" },
    deload: { level: "rest", headline: "今天休息", detail: "负荷突变叠加恢复不足，果断休息，安排散步或拉伸" },
    ramp: { level: "downgrade", headline: "主动降档", detail: "回归期叠加恢复偏低：轻量为主，别急着找回原来的量" },
  },
  bad: {
    build: { level: "downgrade", headline: "主动降档", detail: "恢复较差时不加量：今天很轻的活动即可，先补觉" },
    maintain: { level: "downgrade", headline: "主动降档", detail: "负荷节奏没毛病，但身体信号差：今天降档训练或直接休息" },
    hold: { level: "rest", headline: "今天休息", detail: "恢复差 + 负荷偏高，今天不练，睡眠优先" },
    deload: { level: "rest", headline: "今天休息", detail: "多重负面信号叠加，彻底休息，若持续两天以上建议排查生病前兆" },
    ramp: { level: "rest", headline: "今天休息", detail: "回归期恢复差：先休息观察，持续两天以上留意是否复发" },
  },
};

export function computeReadiness(
  status: TrainingStatus,
  recovery: RecoveryScore,
  opts: { manualSleepQuality?: number | null; loadContext?: LoadContext | null } = {}
): Readiness {
  const manualQ = opts.manualSleepQuality ?? null;
  // 两侧都完全没信息(新用户零训练零数据)时不给假结论。
  const noLoadInfo = status.acwr.zone === null && status.form.zone === null && status.weekly.load7d === 0;
  const noRecoveryInfo =
    recovery.score === null &&
    recovery.components.hrv.z === null &&
    recovery.components.restingHr.z === null &&
    recovery.components.sleep.z === null &&
    recovery.flags.length === 0 &&
    manualQ === null;
  if (noLoadInfo && noRecoveryInfo) {
    return {
      level: "unknown",
      headline: "数据积累中",
      detail: "记录一次训练和一晚睡眠/体征后，这里会给出明确的练休结论",
      recoveryPart: null,
      loadPart: null,
    };
  }
  const rec = classifyRecoveryBand(recovery, manualQ);
  const load = classifyLoadBand(status, { loadContext: opts.loadContext ?? null, recoveryBand: rec.band });
  const combo = COMBOS[rec.band][load.band];
  return {
    level: combo.level,
    headline: combo.headline,
    detail: combo.detail,
    recoveryPart: rec.band === "good" && rec.usedFallback ? "未见负向恢复信号" : rec.note,
    loadPart: load.note,
  };
}
