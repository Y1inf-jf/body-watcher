import { useState } from "react";
import type { HrDay, HrLoadStatus, TrainingStatus } from "@/lib/training-status";
import { ACWR_ZONE_META, FORM_ZONE_META } from "@/lib/zone-meta";
import { Card, CardTitle } from "./ui/Card";
import GaugeRing from "./ui/GaugeRing";

function StatBlock({
  label,
  value,
  sub,
  className = "",
}: {
  label: string;
  value: string;
  sub?: string;
  className?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">{label}</div>
      <div className={`font-mono text-lg font-semibold tabular-nums ${className || "text-zinc-100"}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-zinc-500">{sub}</div>}
    </div>
  );
}

// 训练状态卡:ACWR 圆环 + form / 周负荷 / 单调性 + 28 天负荷迷你柱状图。
export default function TrainingStatusCard({ status }: { status: TrainingStatus }) {
  const acwrZone = status.acwr.zone ? ACWR_ZONE_META[status.acwr.zone] : null;
  const formZone = status.form.zone ? FORM_ZONE_META[status.form.zone] : null;
  // 环满刻度 = 2.0:1.0(平衡)落在半环,>1.5(风险区)逼近满环,视觉上一眼可辨
  const acwrPct = status.acwr.value === null ? null : Math.min(status.acwr.value / 2, 1);
  const ringColor = acwrZone?.hex ?? "#3f3f46";

  const maxLoad = Math.max(...status.series.map((p) => p.load), 1);
  const today = status.series[status.series.length - 1];

  return (
    <Card glowColor={acwrZone?.hex} className="animate-fade-up p-5">
      <CardTitle
        right={
          status.weekly.monotonyWarning ? (
            <span className="rounded border border-zone-amber/40 bg-zone-amber/10 px-1.5 py-0.5 font-mono text-[10px] text-zone-amber">
              ⚠ 单调性 {status.weekly.monotony}
            </span>
          ) : null
        }
      >
        Training Status · 训练状态
      </CardTitle>

      <div className="mt-4 flex items-center gap-6">
        <GaugeRing pct={acwrPct} color={ringColor} size={156} strokeWidth={11}>
          {status.acwr.value !== null && acwrZone ? (
            <>
              <span className={`font-mono text-4xl font-bold tabular-nums ${acwrZone.text}`}>
                {status.acwr.value.toFixed(2)}
              </span>
              <span className={`mt-1 text-xs font-medium tracking-wider ${acwrZone.text}`}>{acwrZone.label}</span>
            </>
          ) : (
            <>
              <span className="font-mono text-4xl font-bold text-zinc-600">—</span>
              <span className="mt-1 px-4 text-center text-[10px] leading-snug text-zinc-500">
                {status.acwr.note ?? "ACWR 未知"}
              </span>
            </>
          )}
        </GaugeRing>

        <div className="min-w-0 flex-1">
          <div className="grid grid-cols-3 gap-3">
            <StatBlock
              label="Form"
              value={status.form.value !== null ? `${status.form.value > 0 ? "+" : ""}${status.form.value}` : "—"}
              sub={formZone?.label ?? "累计中"}
              className={status.form.value !== null && formZone ? formZone.text : "text-zinc-100"}
            />
            <StatBlock label="周负荷" value={`${status.weekly.load7d}`} sub="AU" />
            <StatBlock
              label="单调性"
              value={status.weekly.monotony !== null ? status.weekly.monotony.toFixed(1) : "—"}
              sub={status.weekly.monotonyWarning ? "过高" : "< 2 为佳"}
              className={status.weekly.monotonyWarning ? "text-zone-amber" : "text-zinc-100"}
            />
          </div>

          <div className="mt-4">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">28 天负荷</span>
              <span className="font-mono text-[10px] tabular-nums text-zinc-500">
                今日 {today?.load ?? 0} AU
              </span>
            </div>
            <div className="flex h-10 items-end gap-[3px]">
              {status.series.map((p) => (
                <div
                  key={p.date}
                  title={`${p.date} · ${p.load} AU${p.estimated ? "（估计 RPE）" : ""}`}
                  className={`flex-1 rounded-sm transition-colors ${
                    p.load > 0 ? "bg-zone-green/60 hover:bg-zone-green" : "bg-white/8"
                  }`}
                  style={{
                    height: p.load > 0 ? `${Math.max((p.load / maxLoad) * 100, 8)}%` : "6%",
                  }}
                />
              ))}
            </div>
            <div className="mt-1 flex justify-between font-mono text-[9px] text-zinc-600">
              <span>{status.series[0]?.date.slice(5)}</span>
              <span>{status.acwr.value !== null ? `acute ${status.acwr.acute} · chronic ${status.acwr.chronic}` : ""}</span>
              <span>{today?.date.slice(5)}</span>
            </div>
          </div>

          {status.estimatedSessions > 0 && (
            <p className="mt-2 text-[10px] text-zone-amber/80">
              {status.estimatedSessions}/{status.totalSessions} 次训练的负荷由估计 RPE 得出——在训记里填 RPE 可显著提升精度
            </p>
          )}

          {status.hr && <HrLoadLine hr={status.hr} />}
        </div>
      </div>
    </Card>
  );
}

// 心率负荷对照(手环运动记录的并行 ACWR):与 RPE 负荷互查。
// 两者背离(如 RPE 侧"欠训练"而心率侧不低)多半是 RPE 漏填被低估;daysWithHr 少说明训练时没开运动模式。
// 点击展开近 7 天逐日明细。
function HrLoadLine({ hr }: { hr: HrLoadStatus }) {
  const [open, setOpen] = useState(false);
  const zone = hr.acwr.zone ? ACWR_ZONE_META[hr.acwr.zone] : null;
  const daily = hr.daily ?? [];
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline justify-between gap-2 text-left text-[10px]"
      >
        <span className="shrink-0 uppercase tracking-[0.14em] text-zinc-500">
          <span className="mr-1 inline-block w-2.5 text-zinc-600">{open ? "▾" : "▸"}</span>心率负荷对照
        </span>
        {hr.acwr.value !== null && zone ? (
          <span className={`font-mono tabular-nums ${zone.text}`}>
            HR-ACWR {hr.acwr.value.toFixed(2)} {zone.label} · 周负荷 {hr.load7d} AU · {hr.daysWithHr} 天有手环记录
          </span>
        ) : (
          <span className="font-mono text-zinc-500">{hr.acwr.note ?? "心率负荷累计中"}</span>
        )}
      </button>
      {open && (
        <div className="mt-1.5 overflow-hidden rounded-md border border-white/10">
          {daily.length === 0 ? (
            <p className="px-2.5 py-2 text-[10px] text-zinc-500">
              近 7 天没有手环运动记录——训练时开一次运动模式即可
            </p>
          ) : (
            <table className="w-full table-fixed font-mono text-[10px] tabular-nums">
              <thead>
                <tr className="border-b border-white/10 text-left text-zinc-500">
                  <th className="px-2.5 py-1 font-medium">日期</th>
                  <th className="px-1.5 py-1 font-medium">分钟</th>
                  <th className="px-1.5 py-1 font-medium">均心率</th>
                  <th className="px-1.5 py-1 font-medium">分区</th>
                  <th className="px-2.5 py-1 text-right font-medium">负荷</th>
                </tr>
              </thead>
              <tbody>
                {daily.map((d) => (
                  <tr
                    key={d.date}
                    title={`${d.date} · ${d.count} 次会话${d.calories !== null ? ` · ${d.calories} kcal` : ""}`}
                    className="border-b border-white/5 text-zinc-300 last:border-0"
                  >
                    <td className="px-2.5 py-1">{d.date.slice(5)}</td>
                    <td className="px-1.5 py-1">{d.minutes}</td>
                    <td className="px-1.5 py-1">{d.avgHr ?? "—"}</td>
                    <td className="px-1.5 py-1 text-zinc-400">{zonesLabel(d.zones)}</td>
                    <td className="px-2.5 py-1 text-right">{d.load} AU</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
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
