// 手动录入(daily_health)向设备指标行的补缺合并。dashboard 与教练工具共用,
// 保证"今日建议"在两条入口下看到同一份恢复输入。
import { localDaysAgo } from "./recovery";
import type { GoogleMetricRow } from "./recovery";

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// 同日同字段设备值为 null 时才用手动态(设备优先,手动补充)。
// 手动 sleep_hours 是实际睡眠,映射为在床分钟(无清醒拆分)。
export function mergeManualHealth(
  googleRows: GoogleMetricRow[],
  manualRows: Record<string, unknown>[]
): GoogleMetricRow[] {
  if (manualRows.length === 0) return googleRows;
  const merged = new Map<string, GoogleMetricRow>(googleRows.map((r) => [r.date, { ...r }]));
  for (const m of manualRows) {
    const date = m.date == null ? null : String(m.date);
    if (!date) continue;
    const row = merged.get(date) ?? ({ date } as GoogleMetricRow);
    const hrv = num(m.hrv);
    if (row.hrv_avg_ms == null && hrv !== null) row.hrv_avg_ms = hrv;
    const rhr = num(m.resting_hr);
    if (row.resting_hr == null && rhr !== null) row.resting_hr = rhr;
    const sleepHours = num(m.sleep_hours);
    if (row.sleep_in_bed_minutes == null && sleepHours !== null) row.sleep_in_bed_minutes = Math.round(sleepHours * 60);
    merged.set(date, row);
  }
  return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// 最近一条有睡眠自评(1-10)的手动记录,且必须落在近两晚内——
// 两周前记的自评不代表今天的状态,宁缺毋滥。
export function latestManualSleepQuality(manualRows: Record<string, unknown>[]): number | null {
  const floor = localDaysAgo(1);
  for (let i = manualRows.length - 1; i >= 0; i--) {
    const date = manualRows[i].date == null ? "" : String(manualRows[i].date);
    if (date < floor) break;
    const v = num(manualRows[i].sleep_quality);
    if (v !== null) return v;
  }
  return null;
}
