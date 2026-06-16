import { exportAllTraining, exportAllHealth } from "@/lib/db";

export async function GET() {
  const { logs, exercises } = exportAllTraining();
  const health = exportAllHealth() as Record<string, unknown>[];

  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines: string[] = [];

  lines.push("=== 训练记录 ===");
  lines.push("id,date,duration,total_volume,rpe,notes");
  for (const l of logs) {
    lines.push(`${l.id},${l.date},${esc(l.duration)},${esc(l.total_volume)},${esc(l.rpe)},${esc(l.notes)}`);
  }

  lines.push("");
  lines.push("=== 训练动作 ===");
  lines.push("id,training_log_id,exercise_name,muscle_group,sets,reps,weight,bodyweight,rpe");
  for (const e of exercises) {
    lines.push(`${e.id},${e.training_log_id},${esc(e.exercise_name)},${esc(e.muscle_group)},${esc(e.sets)},${esc(e.reps)},${esc(e.weight)},${esc(e.bodyweight)},${esc(e.rpe)}`);
  }

  lines.push("");
  lines.push("=== 健康数据 ===");
  lines.push("date,hrv,resting_hr,systolic,diastolic,sleep_hours,sleep_quality,weight,body_fat,rpe,rest_day,notes");
  for (const h of health) {
    lines.push(`${h.date},${esc(h.hrv)},${esc(h.resting_hr)},${esc(h.systolic)},${esc(h.diastolic)},${esc(h.sleep_hours)},${esc(h.sleep_quality)},${esc(h.weight)},${esc(h.body_fat)},${esc(h.rpe)},${esc(h.rest_day)},${esc(h.notes)}`);
  }

  const csv = lines.join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=body-watcher-export.csv",
    },
  });
}
