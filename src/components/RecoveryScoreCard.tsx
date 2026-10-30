import type { RecoveryFeatures, RecoveryScore } from "@/lib/recovery";
import type { SleepNeedResult } from "@/lib/training-status";
import { fmtDuration, fmtZ } from "./ui/format";
import Disclosure from "./ui/Disclosure";
import Section from "./ui/Section";
import Tag from "./ui/Tag";

function SignalRow({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string;
  sub: string;
  warn?: boolean;
}) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4 border-t border-line py-3 first:border-t-0">
      <dt className="pt-1 text-xs text-ink-3">{label}</dt>
      <dd className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className={`font-mono text-base tabular-nums ${warn ? "text-zone-red" : "text-ink"}`}>{value}</span>
        <span className="font-mono text-xs tabular-nums text-ink-3">{sub}</span>
      </dd>
    </div>
  );
}

// 身体信号表:大号分数与 zone 标签已在 Hero(KeyMetrics),这里只列构成信号与算式。
export default function RecoveryScoreCard({
  features,
  score,
  sleepNeed,
}: {
  features: RecoveryFeatures;
  score: RecoveryScore;
  sleepNeed: SleepNeedResult | null;
}) {
  const { hrv, restingHr, sleep } = features;
  const debt = sleep.debtMinutes;
  // 债务参照线是"目标底线"抬起来的(还是历史均值),标注给用户的口径不一样。
  const minTarget = features.targets.minMinutes;
  const refIsTarget = minTarget !== null && (sleep.avgAsleep7d === null || minTarget > sleep.avgAsleep7d);

  // 分值构成按实际参与项渲染:某信号缺数据时权重会重分配,静态的"40/30/30"在那一天就是错的。
  const SIGNAL_LABELS = [
    ["hrv", "HRV"],
    ["restingHr", "静息心率"],
    ["sleep", "睡眠"],
  ] as const;
  const usedParts: string[] = [];
  const droppedParts: string[] = [];
  for (const [key, label] of SIGNAL_LABELS) {
    const c = score.components[key];
    if (c.weightUsed != null) usedParts.push(`${label} ${Math.round(c.weightUsed * 100)}%`);
    else if (score.score !== null && c.z === null) droppedParts.push(label);
  }
  const formula =
    score.score !== null && usedParts.length > 0
      ? `${usedParts.join(" + ")}${droppedParts.length > 0 ? `（${droppedParts.join("/")}今日无数据，未计入）` : ""}`
      : "40% HRV + 30% 静息心率 + 30% 睡眠";

  // 实际算式:把参与项的归一化权重与 z 逐项写出来,分数可直接核对,不必反推。
  // 负 z 加括号,避免 "0.50 × -2.01" 这种连字符歧义。
  const terms: string[] = [];
  for (const [key] of SIGNAL_LABELS) {
    const c = score.components[key];
    if (c.weightUsed == null || c.z == null) continue;
    terms.push(`${c.weightUsed.toFixed(2)} × ${c.z < 0 ? `(${c.z.toFixed(2)})` : c.z.toFixed(2)}`);
  }
  const compositeExpr =
    score.score !== null && score.compositeZ != null && terms.length > 0
      ? `${terms.join(" + ")} = ${score.compositeZ.toFixed(2)}`
      : null;

  const hasAside = (features.staleDays !== null && features.staleDays > 0) || score.flags.length > 0;

  return (
    <Section
      index="02"
      title="身体"
      className="animate-fade-up"
      aside={
        hasAside ? (
          <>
            {features.staleDays !== null && features.staleDays > 0 && (
              <Tag tone="amber">
                数据截至 {features.dataDate?.slice(5)} · {features.staleDays} 天未同步
              </Tag>
            )}
            {score.flags.length > 0 && <Tag tone="red">⚠ {score.flags.join(" · ")}</Tag>}
          </>
        ) : undefined
      }
    >
      {score.drag && (
        <p className="mb-3 text-sm text-zone-amber">主要拖累：{score.drag.text}</p>
      )}

      <dl>
        <SignalRow
          label="HRV"
          value={hrv.value != null ? `${hrv.value} ms` : "今日无数据"}
          sub={
            !hrv.ready
              ? "基线累计中"
              : hrv.value == null
                ? `基线 ${hrv.baselineMean ?? "—"} · 今日未计入`
                : `${fmtZ(hrv.zScore)} · 基线 ${hrv.baselineMean ?? "—"}`
          }
          warn={hrv.ready && hrv.zScore !== null && hrv.zScore <= -1}
        />
        <SignalRow
          label="静息心率"
          value={restingHr.value != null ? `${restingHr.value} bpm` : "今日无数据"}
          sub={
            restingHr.deviationBpm != null
              ? `${restingHr.deviationBpm > 0 ? "+" : ""}${restingHr.deviationBpm} bpm · 基线 ${restingHr.baselineMean ?? "—"}`
              : restingHr.value == null && restingHr.ready
                ? `基线 ${restingHr.baselineMean ?? "—"} · 今日未计入`
                : "基线累计中"
          }
          warn={restingHr.deviationBpm != null && restingHr.deviationBpm >= 5}
        />
        <SignalRow
          label="昨晚睡眠"
          value={fmtDuration(sleep.lastNight.asleepMinutes ?? sleep.lastNight.inBedMinutes)}
          sub={
            debt == null
              ? "负债未知"
              : debt > 0
                ? `负债 ${fmtDuration(debt)} · ${refIsTarget ? "目标底线" : "近两晚加权"}`
                : debt < 0
                  ? `盈余 ${fmtDuration(-debt)}`
                  : "无负债"
          }
        />
        <SignalRow
          label="今晚建议"
          value={sleepNeed ? fmtDuration(sleepNeed.minutes) : "—"}
          sub={
            sleepNeed
              ? sleepNeed.baseSource === "target"
                ? `目标 ${fmtDuration(sleepNeed.base)} 打底`
                : `均值 ${fmtDuration(sleepNeed.base)} 打底`
              : "设目标或需 ≥7 天睡眠数据"
          }
        />
      </dl>

      <Disclosure summary="怎么算的" meta="50 = 你的正常水平" className="mt-2 border-t border-line">
        <p className="text-xs text-ink-2">{formula}</p>
        {compositeExpr && (
          <div className="mt-1 space-y-0.5">
            <p className="font-mono text-xs text-ink-3">综合 z = {compositeExpr}</p>
            <p className="font-mono text-xs text-ink-3">正态映射 → {score.score} 分</p>
          </div>
        )}
      </Disclosure>
    </Section>
  );
}
