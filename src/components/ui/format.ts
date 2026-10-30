// 展示用格式化函数(原在 RecoveryScoreCard 内,多处复用故上提)。

export function fmtZ(z: number | null): string {
  return z === null ? "—" : `${z > 0 ? "+" : ""}${z.toFixed(2)}σ`;
}

export function fmtDuration(minutes: number | null): string {
  if (minutes === null) return "—";
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.round(Math.abs(minutes) % 60);
  return `${h}h${String(m).padStart(2, "0")}m`;
}
