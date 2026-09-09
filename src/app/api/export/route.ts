import { exportAllTraining, exportAllGoogleMetrics } from "@/lib/db";

export async function GET() {
  const { logs, exercises } = exportAllTraining();
  const health = exportAllGoogleMetrics();

  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    // 防公式注入:以 = + - @ 开头的单元格在 Excel 中会被当公式执行,前缀单引号按文本处理。
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
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
  lines.push("=== 健康数据(Google 同步)===");
  lines.push("date,hrv_avg_ms,hrv_rmssd_deep_ms,hrv_nonrem_hr,hrv_entropy,resting_hr,respiratory_rate,spo2_avg,weight_kg,steps,exercise_count,exercise_minutes,sleep_in_bed_minutes,sleep_deep_minutes,sleep_rem_minutes,sleep_light_minutes,sleep_awake_minutes,sleep_bedtime,sleep_wakeup");
  for (const h of health) {
    lines.push(
      [
        h.date,
        h.hrv_avg_ms,
        h.hrv_rmssd_deep_ms,
        h.hrv_nonrem_hr,
        h.hrv_entropy,
        h.resting_hr,
        h.respiratory_rate,
        h.spo2_avg,
        h.weight_kg,
        h.steps,
        h.exercise_count,
        h.exercise_minutes,
        h.sleep_in_bed_minutes,
        h.sleep_deep_minutes,
        h.sleep_rem_minutes,
        h.sleep_light_minutes,
        h.sleep_awake_minutes,
        h.sleep_bedtime,
        h.sleep_wakeup,
      ]
        .map(esc)
        .join(",")
    );
  }

  const csv = lines.join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=body-watcher-export.csv",
    },
  });
}
