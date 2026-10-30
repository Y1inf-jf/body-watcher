import type { RecoveryFeatures, RecoveryScore } from "@/lib/recovery";
import type { SleepNeedResult, TrainingStatus } from "@/lib/training-status";
import { ACWR_ZONE_META, RECOVERY_ZONE_META } from "@/lib/zone-meta";
import { fmtDuration } from "./ui/format";
import ScaleBar from "./ui/ScaleBar";
import Tag from "./ui/Tag";
import { ACWR_SCALE, RECOVERY_SCALE, SLEEP_SCALE } from "./ui/scales";

// 恢复分 zone → Tag 语义色
const ZONE_TAG = { green: "green", yellow: "amber", red: "red" } as const;

const BIG = "mt-1 font-mono text-[40px] font-medium leading-none tabular-nums text-ink md:text-5xl";

// Hero 右栏三个关键数字:恢复分 / 负荷比 ACWR / 今晚睡眠需求,各配一条线性刻度。
// 大数字统一 text-ink,状态色只出现在 Tag 色点与刻度条上。
export default function KeyMetrics({
  recovery,
  status,
  sleepNeed,
}: {
  recovery: { features: RecoveryFeatures; score: RecoveryScore };
  status: TrainingStatus;
  sleepNeed: SleepNeedResult | null;
}) {
  const { features, score } = recovery;
  const recZone = score.score !== null && score.zone ? RECOVERY_ZONE_META[score.zone] : null;
  const acwr = status.acwr;
  const acwrZone = acwr.zone ? ACWR_ZONE_META[acwr.zone] : null;

  const block = "py-5 md:px-6 md:first:pl-0 md:last:pr-0 lg:px-0 lg:first:pt-0";

  return (
    <div className="grid divide-y divide-line md:grid-cols-3 md:divide-x md:divide-y-0 lg:grid-cols-1 lg:divide-x-0 lg:divide-y">
      {/* ① 恢复分 */}
      <div className={block}>
        <div className="flex items-center justify-between gap-3 text-xs text-ink-3">
          <span>恢复分</span>
          {recZone && score.zone && <Tag tone={ZONE_TAG[score.zone]}>{recZone.label}</Tag>}
        </div>
        <div className={BIG}>
          {score.score ?? "—"}
          <span className="ml-1 text-sm font-normal text-ink-3">/100</span>
        </div>
        <ScaleBar
          className="mt-4"
          {...RECOVERY_SCALE}
          value={score.score}
          label="恢复分"
          valueText={score.score !== null ? `${score.score} 分 · ${recZone?.label ?? ""}` : undefined}
        />
        <p className="mt-3 text-xs text-ink-2">{recZone?.desc ?? score.note ?? "暂无恢复分"}</p>
        {features.staleDays !== null && features.staleDays > 0 && (
          <p className="mt-1 text-xs text-zone-amber">
            数据截至 {features.dataDate?.slice(5)} · {features.staleDays} 天未同步
          </p>
        )}
      </div>

      {/* ② 负荷比 ACWR */}
      <div className={block}>
        <div className="flex items-center justify-between gap-3 text-xs text-ink-3">
          <span>负荷比 ACWR</span>
          {acwrZone && <Tag tone="neutral">{acwrZone.label}</Tag>}
        </div>
        <div className={BIG}>{acwr.value !== null ? acwr.value.toFixed(2) : "—"}</div>
        <ScaleBar
          className="mt-4"
          {...ACWR_SCALE}
          value={acwr.value}
          label="负荷比 ACWR"
          valueText={acwr.value !== null ? `${acwr.value.toFixed(2)} · ${acwrZone?.label ?? ""}` : undefined}
        />
        <p className="mt-3 text-xs text-ink-2">
          {acwrZone?.desc ?? acwr.note ?? "ACWR 未知"}
          <span className="font-mono text-ink-3"> · 截至 {status.asOf.slice(5)}</span>
        </p>
      </div>

      {/* ③ 今晚睡眠需求 */}
      <div className={block}>
        <div className="text-xs text-ink-3">今晚睡眠需求</div>
        <div className={BIG}>{sleepNeed ? fmtDuration(sleepNeed.minutes) : "—"}</div>
        <ScaleBar
          className="mt-4"
          {...SLEEP_SCALE}
          reference={sleepNeed ? { at: sleepNeed.base } : undefined}
          value={sleepNeed ? sleepNeed.minutes : null}
          label="今晚睡眠需求"
          valueText={sleepNeed ? fmtDuration(sleepNeed.minutes) : undefined}
        />
        <p className="mt-3 text-xs text-ink-2">
          {sleepNeed ? sleepNote(sleepNeed) : "设目标或需 ≥7 天睡眠数据"}
        </p>
      </div>
    </div>
  );
}

function sleepNote(s: SleepNeedResult): string {
  const parts = [`${s.baseSource === "target" ? "目标" : "均值"} ${fmtDuration(s.base)} 打底`];
  if (s.debtComponent !== 0) {
    parts.push(`睡眠债 ${s.debtComponent > 0 ? "+" : "-"}${Math.abs(s.debtComponent)}m`);
  }
  if (s.loadComponent > 0) parts.push(`昨日负荷 +${s.loadComponent}m`);
  return parts.join(" · ");
}
