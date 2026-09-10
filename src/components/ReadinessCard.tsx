"use client";

import { useState } from "react";
import type { RecoveryScore } from "@/lib/recovery";
import type { Readiness } from "@/lib/readiness";
import type { TrainingStatus } from "@/lib/training-status";
import { ACWR_ZONE_META, RECOVERY_ZONE_META, READY_ZONE_META } from "@/lib/zone-meta";
import { Card, CardTitle } from "./ui/Card";

function EvidenceRow({ color, label, text }: { color: string; label: string; text: string }) {
  return (
    <div className="flex items-baseline gap-2 text-[11px] leading-relaxed">
      <span className="h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full" style={{ background: color }} />
      <span className="shrink-0 text-zinc-500">{label}</span>
      <span className="min-w-0 text-zinc-400">{text}</span>
    </div>
  );
}

export interface AdviceView {
  id: number;
  date: string;
  source: "daily" | "plan";
  headline: string;
  status: "pending" | "followed" | "partial" | "skipped";
  felt_rpe: number | null;
  body_notes: string | null;
}

const STATUS_LABEL: Record<AdviceView["status"], string> = {
  pending: "待回填",
  followed: "已采纳",
  partial: "部分采纳",
  skipped: "未采纳",
};
const STATUS_COLOR: Record<AdviceView["status"], string> = {
  pending: "text-zinc-500",
  followed: "text-zone-green",
  partial: "text-zone-amber",
  skipped: "text-zinc-400",
};

// 今日建议卡:恢复(扛不扛得住) × 负荷(练没练多) 合成的一条行动结论。
// 放在恢复/训练状态两张卡之上——先给结论,细节在下面两张卡里看。
// 底部反馈条把"建议→是否照做→体感"闭环回填,供教练后续校准(见 query_advice_history)。
export default function ReadinessCard({
  readiness,
  recovery,
  status,
  advice,
  today,
  onAdviceUpdate,
}: {
  readiness: Readiness;
  recovery: RecoveryScore;
  status: TrainingStatus;
  advice?: AdviceView;
  today?: string;
  onAdviceUpdate?: (a: AdviceView) => void;
}) {
  const zone = READY_ZONE_META[readiness.level];
  const recDot = recovery.score !== null && recovery.zone ? RECOVERY_ZONE_META[recovery.zone].hex : "#52525b";
  const loadDot = status.acwr.zone ? ACWR_ZONE_META[status.acwr.zone].hex : "#52525b";

  return (
    <Card glowColor={zone.hex} className="animate-fade-up p-5">
      <CardTitle
        right={
          <span className={`rounded border px-2 py-0.5 font-mono text-[10px] ${zone.border} ${zone.bg} ${zone.text}`}>
            {zone.label}
          </span>
        }
      >
        Today · 今日建议
      </CardTitle>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <span className={`text-3xl font-bold tracking-wide ${zone.text}`}>{readiness.headline}</span>
        <p className="min-w-0 max-w-[28rem] flex-1 text-right text-sm leading-relaxed text-zinc-400">
          {readiness.detail}
        </p>
      </div>

      {(readiness.recoveryPart || readiness.loadPart) && (
        <div className="mt-3 space-y-1.5 border-t border-white/5 pt-3">
          {readiness.recoveryPart && <EvidenceRow color={recDot} label="恢复" text={readiness.recoveryPart} />}
          {readiness.loadPart && <EvidenceRow color={loadDot} label="负荷" text={readiness.loadPart} />}
        </div>
      )}

      {advice && <AdviceFeedback key={advice.id} advice={advice} today={today} onUpdate={onAdviceUpdate} />}

      <p className="mt-2 text-[10px] text-zinc-600">
        恢复决定今天练多重，负荷决定今天练不练 · 当下体感与它冲突时，以体感为准
      </p>
    </Card>
  );
}

// 建议闭环反馈:卡片主体展示的是今天的恢复结论,而回填目标由后端选定——
// 晨访时优先递最近一条未回填的往日建议(通常是昨天,练完当晚不看站的人早上补),
// 无积压则挂今天这条。选完即写库,教练下次会读到。
function AdviceFeedback({
  advice,
  today,
  onUpdate,
}: {
  advice: AdviceView;
  today?: string;
  onUpdate?: (a: AdviceView) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<AdviceView["status"]>(advice.status);
  const [rpe, setRpe] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const resolved = advice.status !== "pending" && !editing;

  // 往日建议要亮出日期与原文,否则用户面对的是今天的结论、评的却是昨天的建议。
  const dayDiff =
    today && advice.date < today
      ? Math.round((Date.parse(today) - Date.parse(advice.date)) / 86400000)
      : 0;
  const dayLabel = dayDiff === 1 ? "昨天" : dayDiff > 1 ? advice.date.slice(5) : "";
  const question = dayDiff >= 1 ? `${dayLabel}这条建议，做到了吗？` : "这条建议，今天做到了吗？";

  const pick = (s: AdviceView["status"]) => {
    setPicked(s);
    setEditing(true);
  };

  const submit = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/advice", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: advice.id,
          status: picked,
          felt_rpe: rpe ? parseInt(rpe) : null,
          body_notes: notes.trim() || null,
        }),
      });
      if (res.ok) {
        const d = await res.json();
        onUpdate?.(d.advice);
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 border-t border-white/5 pt-3">
      {dayLabel && (
        <p className="mb-1.5 text-xs text-zinc-300">
          <span className="text-zinc-500">{dayLabel}的建议</span> · {advice.headline}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-zinc-500">{question}</span>
        {resolved && (
          <span className={`text-[11px] ${STATUS_COLOR[advice.status]}`}>
            {STATUS_LABEL[advice.status]}
            {advice.felt_rpe ? ` · 体感 ${advice.felt_rpe}/10` : ""}
          </span>
        )}
      </div>

      {resolved ? (
        <div className="mt-1.5 flex items-center justify-between gap-3">
          {advice.body_notes ? (
            <p className="min-w-0 truncate text-xs text-zinc-400">“{advice.body_notes}”</p>
          ) : (
            <span className="text-xs text-zinc-600">未填体感</span>
          )}
          <button
            onClick={() => setEditing(true)}
            className="shrink-0 text-[11px] text-zinc-500 transition-colors hover:text-zinc-200"
          >
            修改
          </button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {(["followed", "partial", "skipped"] as const).map((s) => (
              <button
                key={s}
                onClick={() => pick(s)}
                className={`rounded-lg border px-3 py-1 text-xs transition-colors ${
                  picked === s
                    ? "border-accent/50 bg-accent/15 text-accent"
                    : "border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-200"
                }`}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={1}
              max={10}
              value={rpe}
              onChange={(e) => setRpe(e.target.value)}
              placeholder="体感 1-10"
              className="w-24 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
            />
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && picked !== "pending" && submit()}
              placeholder="一句话感受（可选），如：降档后反而有劲"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
            />
            <button
              onClick={submit}
              disabled={picked === "pending" || saving}
              className="rounded-lg bg-accent/90 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition-colors hover:bg-accent disabled:opacity-40"
            >
              {saving ? "保存中" : "记录"}
            </button>
            {advice.status !== "pending" && (
              <button
                onClick={() => setEditing(false)}
                className="text-[11px] text-zinc-600 transition-colors hover:text-zinc-300"
              >
                取消
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
