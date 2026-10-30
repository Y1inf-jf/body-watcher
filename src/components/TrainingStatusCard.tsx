import type { HrDay, HrLoadStatus, TrainingStatus } from "@/lib/training-status";
import type { LoadContext } from "@/lib/load-context";
import { ACWR_ZONE_META, FORM_ZONE_META } from "@/lib/zone-meta";
import Disclosure from "./ui/Disclosure";
import Section from "./ui/Section";
import Stat from "./ui/Stat";
import Tag from "./ui/Tag";

// 训练负荷卡:ACWR / Form / 周负荷 / 单调性 + 28 天负荷迷你柱状图。
// ACWR 的刻度条在 Hero 的 KeyMetrics 里,这里保留数值与急慢性负荷明细。
export default function TrainingStatusCard({
  status,
  loadContext = null,
}: {
  status: TrainingStatus;
  loadContext?: LoadContext | null;
}) {
  const acwrZone = status.acwr.zone ? ACWR_ZONE_META[status.acwr.zone] : null;
  const formZone = status.form.zone ? FORM_ZONE_META[status.form.zone] : null;

  const maxLoad = Math.max(...status.series.map((p) => p.load), 1);
  const lastPoint = status.series[status.series.length - 1];
  const ret = loadContext?.phase === "return" ? loadContext : null;
  const hasAside = ret !== null || status.weekly.monotonyWarning;

  return (
    <Section
      index="03"
      title="负荷"
      className="animate-fade-up"
      aside={
        hasAside ? (
          <>
            {ret && (
              <Tag tone="accent">回归期 · {ret.week === 0 ? "未恢复训练" : `第 ${ret.week} 周`}</Tag>
            )}
            {status.weekly.monotonyWarning && <Tag tone="amber">⚠ 单调性 {status.weekly.monotony}</Tag>}
          </>
        ) : undefined
      }
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <Stat
          label="ACWR"
          value={status.acwr.value !== null ? status.acwr.value.toFixed(2) : "—"}
          tone={acwrZone ? acwrZone.text : "text-ink"}
          sub={
            status.acwr.value !== null
              ? `急性 ${status.acwr.acute} · 慢性 ${status.acwr.chronic}`
              : (status.acwr.note ?? "ACWR 未知")
          }
        />
        <Stat
          label="Form"
          value={status.form.value !== null ? `${status.form.value > 0 ? "+" : ""}${status.form.value}` : "—"}
          tone={status.form.value !== null && formZone ? formZone.text : "text-ink"}
          sub={formZone?.label ?? "累计中"}
        />
        <Stat label="周负荷" value={`${status.weekly.load7d}`} sub="AU · 截至昨日" />
        <Stat
          label="单调性"
          value={status.weekly.monotony !== null ? status.weekly.monotony.toFixed(1) : "—"}
          tone={status.weekly.monotonyWarning ? "text-zone-amber" : "text-ink"}
          sub={status.weekly.monotonyWarning ? "过高" : "< 2 为佳"}
        />
      </div>
      {status.asOf && (
        <p className="mt-3 text-xs text-ink-3">
          ACWR / Form / 周负荷 / 单调性截至 {status.asOf.slice(5)}，今天的训练明天计入
        </p>
      )}

      <div className="mt-6">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <span className="text-xs text-ink-3">近 28 天负荷</span>
          <span className="font-mono text-xs tabular-nums text-ink-3">
            今日 {status.todayLoad} AU{status.todayLoad > 0 ? "（明日计入）" : ""}
          </span>
        </div>
        <div role="img" aria-label="近 28 天每日训练负荷" className="flex h-16 items-end gap-[2px]">
          {status.series.map((p, i) => {
            const isToday = i === status.series.length - 1;
            const cls =
              p.load <= 0
                ? "bg-line"
                : isToday
                  ? "border border-dashed border-ink-3 bg-transparent"
                  : `bg-ink-3 hover:bg-ink-2 ${p.estimated ? "opacity-50" : ""}`;
            return (
              <div
                key={p.date}
                title={`${p.date} · ${p.load} AU${p.estimated ? "（估计 RPE）" : ""}`}
                className={`flex-1 rounded-sm transition-colors ${cls}`}
                style={{
                  height: p.load > 0 ? `${Math.max((p.load / maxLoad) * 100, 8)}%` : "2px",
                }}
              />
            );
          })}
        </div>
        <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-3">
          <span>{status.series[0]?.date.slice(5)}</span>
          <span>{lastPoint?.date.slice(5)}</span>
        </div>
      </div>

      {status.allSessionsEstimated ? (
        <p className="mt-3 text-xs text-zone-amber">
          无 RPE 模式：负荷按组数和时长估算，仅用于看趋势；估算出的“负荷偏低”不会触发加量建议。
        </p>
      ) : status.estimatedSessions > 0 ? (
        <p className="mt-3 text-xs text-zone-amber">
          {status.estimatedSessions}/{status.totalSessions} 次训练的负荷由组数和时长估算，趋势请结合手环心率负荷对照。
        </p>
      ) : null}

      {ret && (
        <div className="mt-4 border-l-2 border-accent pl-3">
          <p className="text-xs text-ink-2">{ret.note}</p>
          {ret.weekCap !== null && ret.week > 0 && (
            <div className="mt-2 flex items-center gap-3">
              <div className="h-1 flex-1 overflow-hidden bg-line">
                <div
                  className={`h-full ${ret.weekLoad > ret.weekCap ? "bg-zone-amber" : "bg-accent"}`}
                  style={{ width: `${Math.min((ret.weekLoad / ret.weekCap) * 100, 100)}%` }}
                />
              </div>
              <span className="shrink-0 font-mono text-[11px] text-ink-3">
                本周 {ret.weekLoad}/{ret.weekCap} AU
              </span>
            </div>
          )}
        </div>
      )}
      {status.extraActivities.length > 0 && (
        <p className="mt-3 text-xs text-ink-3">
          含手环运动：
          {status.extraActivities.map((a) => `${a.date.slice(5)} ${a.label} ${a.minutes} 分钟（+${Math.round(a.load)} AU）`).join("；")}
        </p>
      )}
      {status.durationCorrected > 0 && (
        <p className="mt-1 text-xs text-ink-3">{status.durationCorrected} 次训练时长按手环运动记录修正</p>
      )}

      {status.hr && <HrLoadLine hr={status.hr} />}
    </Section>
  );
}

// 心率负荷对照(手环运动记录的并行 ACWR):与 RPE 负荷互查。
// 两者背离(如 RPE 侧"负荷偏低"而心率侧不低)多半是 RPE 漏填被低估;daysWithHr 少说明训练时没开运动模式。
// 展开可看近 7 天逐日明细。
function HrLoadLine({ hr }: { hr: HrLoadStatus }) {
  const zone = hr.acwr.zone ? ACWR_ZONE_META[hr.acwr.zone] : null;
  const daily = hr.daily ?? [];
  return (
    <Disclosure
      className="mt-4 border-t border-line"
      summary="心率负荷对照"
      meta={
        hr.acwr.value !== null && zone ? (
          <span className={`font-mono tabular-nums ${zone.text}`}>
            HR-ACWR {hr.acwr.value.toFixed(2)} {zone.label} · 周负荷 {hr.load7d} AU · {hr.daysWithHr} 天有手环记录
          </span>
        ) : (
          <span className="font-mono">{hr.acwr.note ?? "心率负荷累计中"}</span>
        )
      }
    >
      {daily.length === 0 ? (
        <p className="text-xs text-ink-3">近 7 天没有手环运动记录——训练时开一次运动模式即可</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[22rem] font-mono text-xs tabular-nums">
            <thead>
              <tr className="border-b border-line text-left text-ink-3">
                <th className="py-1 pr-2 font-medium">日期</th>
                <th className="px-2 py-1 font-medium">分钟</th>
                <th className="px-2 py-1 font-medium">均心率</th>
                <th className="px-2 py-1 font-medium">分区</th>
                <th className="py-1 pl-2 text-right font-medium">负荷</th>
              </tr>
            </thead>
            <tbody>
              {daily.map((d) => (
                <tr
                  key={d.date}
                  title={`${d.date} · ${d.count} 次会话${d.calories !== null ? ` · ${d.calories} kcal` : ""}`}
                  className="border-b border-line text-ink last:border-0"
                >
                  <td className="py-1 pr-2">{d.date.slice(5)}</td>
                  <td className="px-2 py-1">{d.minutes}</td>
                  <td className="px-2 py-1">{d.avgHr ?? "—"}</td>
                  <td className="px-2 py-1 text-ink-2">{zonesLabel(d.zones)}</td>
                  <td className="py-1 pl-2 text-right">{d.load} AU</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Disclosure>
  );
}

const ZONE_LABELS: Record<keyof HrDay["zones"], string> = { light: "轻", moderate: "中", vigorous: "剧", peak: "峰" };

// "轻 46分 中 3分"——只列非零区,秒取整为分钟。
function zonesLabel(z: HrDay["zones"]): string {
  const parts = (Object.keys(ZONE_LABELS) as (keyof HrDay["zones"])[])
    .filter((k) => z[k] > 0)
    .map((k) => `${ZONE_LABELS[k]}${Math.round(z[k] / 60)}分`);
  return parts.length > 0 ? parts.join(" ") : "—";
}
