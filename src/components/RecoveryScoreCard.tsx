import type { RecoveryFeatures, RecoveryScore } from "@/lib/recovery";
import type { SleepNeedResult } from "@/lib/training-status";
import { RECOVERY_ZONE_META } from "@/lib/zone-meta";
import { Card, CardTitle } from "./ui/Card";
import GaugeRing from "./ui/GaugeRing";

function fmtZ(z: number | null): string {
  return z === null ? "—" : `${z > 0 ? "+" : ""}${z.toFixed(2)}σ`;
}

function fmtDuration(minutes: number | null): string {
  if (minutes === null) return "—";
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.round(Math.abs(minutes) % 60);
  return `${h}h${String(m).padStart(2, "0")}m`;
}

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
    <div className="flex items-baseline justify-between gap-3 border-b border-white/5 py-1.5 last:border-0">
      <span className="shrink-0 text-xs text-zinc-500">{label}</span>
      <span className="min-w-0 text-right">
        <span className={`font-mono text-sm font-semibold tabular-nums ${warn ? "text-zone-red" : "text-zinc-100"}`}>
          {value}
        </span>
        <span className="ml-2 font-mono text-[11px] tabular-nums text-zinc-500">{sub}</span>
      </span>
    </div>
  );
}

export default function RecoveryScoreCard({
  features,
  score,
  sleepNeed,
}: {
  features: RecoveryFeatures;
  score: RecoveryScore;
  sleepNeed: SleepNeedResult | null;
}) {
  const zone = score.zone ? RECOVERY_ZONE_META[score.zone] : null;
  const { hrv, restingHr, sleep } = features;
  const debt = sleep.debtMinutes;
  // 债务参照线是"目标底线"抬起来的(还是历史均值),标注给用户的口径不一样。
  const minTarget = features.targets.minMinutes;
  const refIsTarget = minTarget !== null && (sleep.avgAsleep7d === null || minTarget > sleep.avgAsleep7d);

  return (
    <Card glowColor={zone?.hex} className="animate-fade-up p-5">
      <CardTitle
        right={
          <div className="flex items-center gap-2">
            {features.staleDays !== null && features.staleDays > 0 && (
              <span className="rounded border border-zone-amber/40 bg-zone-amber/10 px-1.5 py-0.5 font-mono text-[10px] text-zone-amber">
                数据截至 {features.dataDate?.slice(5)} · {features.staleDays} 天未同步
              </span>
            )}
            {score.flags.length > 0 && (
              <span className="rounded border border-zone-red/40 bg-zone-red/10 px-1.5 py-0.5 font-mono text-[10px] text-zone-red">
                ⚠ {score.flags.join(" · ")}
              </span>
            )}
          </div>
        }
      >
        Recovery · 今日恢复分
      </CardTitle>

      <div className="mt-4 flex items-center gap-6">
        <GaugeRing pct={score.score === null ? null : score.score / 100} color={zone?.hex ?? "#3f3f46"} size={156} strokeWidth={11}>
          {score.score !== null && zone ? (
            <>
              <span className={`font-mono text-5xl font-bold tabular-nums ${zone.text}`}>{score.score}</span>
              <span className={`mt-1 text-xs font-medium tracking-wider ${zone.text}`}>{zone.label}</span>
            </>
          ) : (
            <>
              <span className="font-mono text-4xl font-bold text-zinc-600">—</span>
              <span className="mt-1 px-4 text-center text-[10px] leading-snug text-zinc-500">
                {score.note ?? "暂无恢复分"}
              </span>
            </>
          )}
        </GaugeRing>

        <div className="min-w-0 flex-1">
          <SignalRow
            label="HRV"
            value={hrv.value != null ? `${hrv.value} ms` : "—"}
            sub={hrv.ready ? `${fmtZ(hrv.zScore)} · 基线 ${hrv.baselineMean ?? "—"}` : "基线累计中"}
            warn={hrv.ready && hrv.zScore !== null && hrv.zScore <= -1}
          />
          <SignalRow
            label="静息心率"
            value={restingHr.value != null ? `${restingHr.value} bpm` : "—"}
            sub={
              restingHr.deviationBpm != null
                ? `${restingHr.deviationBpm > 0 ? "+" : ""}${restingHr.deviationBpm} bpm · 基线 ${restingHr.baselineMean ?? "—"}`
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
                  ? `负债 ${fmtDuration(debt)} · ${refIsTarget ? "目标底线" : "近两晚最差"}`
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
          <p className="mt-2 text-[10px] text-zinc-600">
            50 = 你的正常水平 · 40% HRV + 30% 静息心率 + 30% 睡眠
          </p>
        </div>
      </div>
    </Card>
  );
}
