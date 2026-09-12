// 主动洞察规则引擎:每次数据同步完成后跑一遍(scheduling 在 instrumentation.ts),
// 命中的规则按 (rule_id, date) 去重落库,总览页横幅展示。原则:数据不新鲜/基线不足不点火,
// 宁缺毋滥——洞察比推送廉价,噪音会训练用户无视横幅。
import { clearInsight, countStalePendingAdvice, upsertInsight } from "./db";
import { loadDailyContext, type DailyContext } from "./daily-context";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/**
 * 计算并落库今日洞察。
 *
 * ctx 可选:同步流程已经算过一份上下文时直接传进来,避免同一轮重复查询与计算;
 * 不传则内部按统一口径现算一份(见 lib/daily-context.ts)。
 */
export function computeInsights(ctx?: DailyContext): void {
  const context = ctx ?? loadDailyContext();
  const today = context.today;
  // 与 dashboard 同源:设备数据 + 手动补缺 + 用户睡眠目标。
  const features = context.recoveryFeatures;
  const status = context.trainingStatus;
  // 设备数据今天/昨天才算新鲜:陈旧数据上点火只会误导。
  const fresh = (features.staleDays ?? 99) <= 1;

  // 1. 睡眠债:参照线下欠 45 分钟以上(与教练提示词的阈值一致)。
  const debt = features.sleep.debtMinutes;
  if (fresh && debt !== null && debt >= 45) {
    const ref = features.sleep.debtRefMinutes;
    upsertInsight(
      "sleep_debt",
      today,
      "warn",
      "睡眠债偏大",
      `近两晚最差一晚欠觉约 ${debt} 分钟${ref ? `(参照线 ${Math.round(ref / 60)} 小时档)` : ""}。连续欠觉会拖垮恢复与训练质量，今晚优先补觉，别安排大重量。`
    );
  }

  // 2. HRV 明显低于个人基线(基线至少 14 天才可信)。
  const hrvZ = features.hrv.zScore;
  if (fresh && hrvZ !== null && hrvZ <= -1 && (features.hrv.baselineDays ?? 0) >= 14) {
    upsertInsight(
      "hrv_low",
      today,
      "warn",
      "HRV 低于基线",
      `今日 HRV 相对基线 z ≈ ${hrvZ}(基线 ${features.hrv.baselineDays} 天)。自主神经提示压力偏大：今天练轻一点，或直接主动恢复。`
    );
  }

  // 3. 负荷:ACWR 超 1.3 提醒,超 1.5 警告(与教练提示词同口径)。
  const acwr = status.acwr.value;
  if (acwr !== null && acwr > 1.5) {
    upsertInsight("acwr_high", today, "alert", "急性负荷峰值", `急慢性负荷比 ${acwr.toFixed(2)}(>1.5)。近期加量过猛，这一两天只做轻松恢复，把慢性池追上来。`);
  } else if (acwr !== null && acwr > 1.3) {
    upsertInsight("acwr_high", today, "warn", "负荷偏高", `急慢性负荷比 ${acwr.toFixed(2)}(>1.3)。可以练，但别再加量，维持现有节奏即可。`);
  }

  // 4. 停训空窗:有训练史但已 ≥5 天没练(排出今天数据未同步的情况无影响,训练记录是本地落库)。
  const lastDate = context.lastSessionDate;
  if (lastDate) {
    const gap = daysBetween(lastDate, today);
    if (gap >= 5) {
      upsertInsight(
        "detrain_gap",
        today,
        "info",
        `已经 ${gap} 天没练了`,
        `上次训练是 ${lastDate}。超过一周再练建议先降一档容量找回节奏，别直接回到停练前的重量。`
      );
    }
  }

  // 5. 闭环提醒:近 7 天有 3 条以上日建议还没回填,轻推一下(闭环比"看起来智能"更重要)。
  const stale = countStalePendingAdvice(7);
  if (stale >= 3) {
    upsertInsight(
      "advice_stale",
      today,
      "info",
      `${stale} 条建议还没回填`,
      "早上打开总览页会把最近没回填的建议递给你。回填得越勤，教练对你的判断越准。"
    );
  } else {
    // 积压清完了就让横幅当场消失,而不是挂到隔天。
    clearInsight("advice_stale", today);
  }
}
