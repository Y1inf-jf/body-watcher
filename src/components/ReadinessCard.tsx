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

// 今日建议卡:恢复(扛不扛得住) × 负荷(练没练多) 合成的一条行动结论。
// 放在恢复/训练状态两张卡之上——先给结论,细节在下面两张卡里看。
export default function ReadinessCard({
  readiness,
  recovery,
  status,
}: {
  readiness: Readiness;
  recovery: RecoveryScore;
  status: TrainingStatus;
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

      <p className="mt-2 text-[10px] text-zinc-600">
        恢复决定今天练多重，负荷决定今天练不练 · 当下体感与它冲突时，以体感为准
      </p>
    </Card>
  );
}
