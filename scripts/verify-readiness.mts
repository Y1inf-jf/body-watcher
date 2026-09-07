// 恢复/合成建议的回归验证脚本(手动运行,无测试框架依赖): npx -y tsx scripts/verify-readiness.mts
import { computeRecoveryFeatures, computeRecoveryScore } from "../src/lib/recovery";
import { computeTrainingStatus, computeSleepNeed } from "../src/lib/training-status";
import { computeReadiness } from "../src/lib/readiness";
import { mergeManualHealth, latestManualSleepQuality } from "../src/lib/health-merge";
import type { GoogleMetricRow, TrainingLogRow } from "../src/lib/recovery";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`, detail ?? ""); }
}

// ---------- 1. 睡眠债口径 ----------
console.log("[睡眠债]");
function sleepRow(date: string, inBed: number | null, awake: number | null = 0, hrv: number | null = null, rhr: number | null = null): GoogleMetricRow {
  return { date, sleep_in_bed_minutes: inBed, sleep_awake_minutes: awake, hrv_rmssd_deep_ms: hrv, resting_hr: rhr };
}
{
  // 近 7 晚实际睡眠 ~480,昨晚在床 470 但醒 90 → 实际 380 → 债 ≈100(旧口径:在床 470,债为负)
  const rows: GoogleMetricRow[] = [
    sleepRow("2026-09-01", 480), sleepRow("2026-09-02", 480), sleepRow("2026-09-03", 480),
    sleepRow("2026-09-04", 480), sleepRow("2026-09-05", 480), sleepRow("2026-09-06", 480),
    sleepRow("2026-09-07", 480),
    sleepRow("2026-09-08", 470, 90), // 昨晚:在床 470 醒 90 → 实际 380
  ];
  const f = computeRecoveryFeatures(rows);
  check("债务>0(旧口径会算出盈余)", f.sleep.debtMinutes !== null && f.sleep.debtMinutes > 60, f.sleep.debtMinutes);
  check("实际睡眠字段存在", f.sleep.lastNight.asleepMinutes === 380, f.sleep.lastNight);
}
{
  // 取两晚中较差的:昨晚 480 达标,但前晚(倒数第二天)只睡 360 → 债按前晚算
  const rows: GoogleMetricRow[] = [
    sleepRow("2026-08-28", 480), sleepRow("2026-08-29", 480), sleepRow("2026-08-30", 480),
    sleepRow("2026-08-31", 480), sleepRow("2026-09-01", 480), sleepRow("2026-09-02", 480),
    sleepRow("2026-09-03", 480), sleepRow("2026-09-04", 480), sleepRow("2026-09-05", 480),
    sleepRow("2026-09-06", 480), sleepRow("2026-09-07", 360, 0), sleepRow("2026-09-08", 480, 0),
  ];
  const f = computeRecoveryFeatures(rows);
  check("前晚差 → 债>90", f.sleep.debtMinutes !== null && f.sleep.debtMinutes > 90, f.sleep.debtMinutes);
}
{
  // 正常睡眠:债 ≈ 0 不压分
  const rows: GoogleMetricRow[] = Array.from({ length: 8 }, (_, i) =>
    sleepRow(`2026-09-0${i + 1}`, 480, 0, 50, 60));
  const f = computeRecoveryFeatures(rows);
  check("正常睡眠债≈0", Math.abs(f.sleep.debtMinutes ?? 99) <= 5, f.sleep.debtMinutes);
}

// ---------- 1.5 三档睡眠目标 ----------
console.log("[睡眠目标]");
{
  // 两晚差睡眠(380)混在好觉里:均值参照被拉低,min 目标把参照线抬回 500
  const rows: GoogleMetricRow[] = [
    sleepRow("2026-09-01", 480), sleepRow("2026-09-02", 480), sleepRow("2026-09-03", 480),
    sleepRow("2026-09-04", 480), sleepRow("2026-09-05", 480), sleepRow("2026-09-06", 480, 100),
    sleepRow("2026-09-07", 480, 100), sleepRow("2026-09-08", 480),
  ];
  const noMin = computeRecoveryFeatures(rows);
  const withMin = computeRecoveryFeatures(rows, { sleepTargets: { minMinutes: 500, targetMinutes: null, idealMinutes: null } });
  const lowMin = computeRecoveryFeatures(rows, { sleepTargets: { minMinutes: 300, targetMinutes: null, idealMinutes: null } });
  check("min>均值 → 参照线抬高、债务更大", (withMin.sleep.debtMinutes ?? 0) > (noMin.sleep.debtMinutes ?? 0), [noMin.sleep.debtMinutes, withMin.sleep.debtMinutes]);
  check("参照线回显为目标值", withMin.sleep.debtRefMinutes === 500, withMin.sleep.debtRefMinutes);
  check("min<均值 → 目标不拉低参照", lowMin.sleep.debtMinutes === noMin.sleep.debtMinutes, [lowMin.sleep.debtMinutes, noMin.sleep.debtMinutes]);
}
{
  // 冷启动只有一晚:无目标算不了债,设了 min 就能算
  const cold = [sleepRow("2026-09-08", 400, 40)]; // 实际 360
  check("冷启动无目标 → 债为 null", computeRecoveryFeatures(cold).sleep.debtMinutes === null);
  const coldT = computeRecoveryFeatures(cold, { sleepTargets: { minMinutes: 450, targetMinutes: null, idealMinutes: null } });
  check("冷启动设 min=450 → 债 90", coldT.sleep.debtMinutes === 90, coldT.sleep.debtMinutes);
}
{
  // 今晚建议:target 抬地板、ideal 封顶
  const good: GoogleMetricRow[] = Array.from({ length: 8 }, (_, i) => sleepRow(`2026-09-0${i + 1}`, 480, 0));
  const f = computeRecoveryFeatures(good);
  const needAvg = computeSleepNeed(f.sleep, 0);
  check("无目标地板=均值", needAvg?.base === 480 && needAvg.baseSource === "avg7d", needAvg);
  const needTgt = computeSleepNeed(f.sleep, 0, { targetMinutes: 510 });
  check("target 抬高地板", needTgt?.base === 510 && needTgt.baseSource === "target", needTgt);
  const needLow = computeSleepNeed(f.sleep, 0, { targetMinutes: 450 });
  check("target 低于均值不降地板", needLow?.baseSource === "avg7d" && needLow.base === 480, needLow);
  const bad: GoogleMetricRow[] = [
    ...Array.from({ length: 6 }, (_, i) => sleepRow(`2026-09-0${i + 1}`, 480, 0)),
    sleepRow("2026-09-07", 480, 100), sleepRow("2026-09-08", 480),
  ];
  const fb = computeRecoveryFeatures(bad);
  const needCap = computeSleepNeed(fb.sleep, 300, { targetMinutes: 480, idealMinutes: 490 });
  check("ideal 封顶生效", needCap?.minutes === 490, needCap);
}

// ---------- 2. 手动合并 ----------
console.log("[手动合并]");
{
  const dev: GoogleMetricRow[] = [{ date: "2026-09-07", sleep_in_bed_minutes: null } as GoogleMetricRow];
  const merged = mergeManualHealth(dev, [
    { date: "2026-09-06", sleep_hours: 7, hrv: 55, resting_hr: 58, sleep_quality: 8 },
    { date: "2026-09-07", sleep_hours: 6.5, sleep_quality: 4 },
  ]);
  check("手动行被补进且升序", merged.length === 2 && merged[0].date === "2026-09-06");
  const m7 = merged.find((r) => r.date === "2026-09-07")!;
  check("sleep_hours 换算在床分钟", m7.sleep_in_bed_minutes === 390, m7);
  const q = latestManualSleepQuality([{ date: "2026-09-01", sleep_quality: 2 }, { date: "2026-09-07", sleep_quality: 4 }]);
  check("自评只取近两晚", q === 4, q);
  check("设备已有值不被手动覆盖", mergeManualHealth(
    [{ date: "2026-09-07", sleep_in_bed_minutes: 500 } as GoogleMetricRow],
    [{ date: "2026-09-07", sleep_hours: 6 }]
  )[0].sleep_in_bed_minutes === 500);
}

// ---------- 3. 真实数据回放(服务器 2026-08-28..09-07) ----------
console.log("[真实回放]");
{
  const google: GoogleMetricRow[] = [
    { date: "2026-08-28", hrv_rmssd_deep_ms: 67.7, resting_hr: 57 },
    { date: "2026-08-29", hrv_rmssd_deep_ms: 80.6, resting_hr: 55, sleep_in_bed_minutes: 482, sleep_awake_minutes: 2, sleep_deep_minutes: 73, spo2_avg: 95, respiratory_rate: 15.8, steps: 7055 },
    { date: "2026-08-30", hrv_rmssd_deep_ms: 84.9, resting_hr: 53, sleep_in_bed_minutes: 472, sleep_awake_minutes: 0, sleep_deep_minutes: 92, spo2_avg: 95, respiratory_rate: 15.8, steps: 3818 },
    { date: "2026-08-31", resting_hr: 57 },
    { date: "2026-09-01", spo2_avg: 95, resting_hr: 56, hrv_rmssd_deep_ms: 41.9 },
    { date: "2026-09-02", spo2_avg: 95, resting_hr: 57 },
    { date: "2026-09-03", spo2_avg: 96.4, resting_hr: 57 },
    { date: "2026-09-04", sleep_in_bed_minutes: 474, sleep_awake_minutes: 11, sleep_deep_minutes: 115, hrv_rmssd_deep_ms: 49.9, resting_hr: 70, respiratory_rate: 16.4, spo2_avg: 95.1, steps: 5544 },
    { date: "2026-09-05", sleep_in_bed_minutes: 495, sleep_awake_minutes: 13, sleep_deep_minutes: 89, hrv_rmssd_deep_ms: 57.4, resting_hr: 68, respiratory_rate: 16.4, steps: 8588 },
    { date: "2026-09-06", sleep_in_bed_minutes: 476, sleep_awake_minutes: 97, sleep_deep_minutes: 62, hrv_rmssd_deep_ms: 35.6, resting_hr: 70, respiratory_rate: 16.4, spo2_avg: 93.9, steps: 3814 },
    { date: "2026-09-07", sleep_in_bed_minutes: 553, sleep_awake_minutes: 66, sleep_deep_minutes: 95, hrv_rmssd_deep_ms: 64.5, resting_hr: 68, respiratory_rate: 16.6, steps: 1659 },
  ] as GoogleMetricRow[];
  const logs = [
    { date: "2026-09-07", duration: 56, rpe: 8 }, { date: "2026-09-04", duration: 60, rpe: 8 },
    { date: "2026-09-02", duration: 53, rpe: 8 }, { date: "2026-08-30", duration: 52, rpe: 8 },
    { date: "2026-08-28", duration: 41, rpe: 8 },
  ] as TrainingLogRow[];

  const devOnly = computeReadiness(computeTrainingStatus(logs), computeRecoveryScore(computeRecoveryFeatures(google)));
  console.log(`  仅设备: ${devOnly.level}(${devOnly.headline}) | ${devOnly.recoveryPart}`);
  const merged = computeReadiness(computeTrainingStatus(logs),
    computeRecoveryScore(computeRecoveryFeatures(mergeManualHealth(google, [
      { date: "2026-09-06", sleep_hours: 6.3, sleep_quality: 3 },
      { date: "2026-09-07", sleep_hours: 8, sleep_quality: 6 },
    ]))), { manualSleepQuality: 6 });
  console.log(`  含手动: ${merged.level}(${merged.headline}) | ${merged.recoveryPart}`);
  check("设备数据基线已就绪 → 恢复分出结论(25分档)", devOnly.recoveryPart !== null && /恢复分/.test(devOnly.recoveryPart), devOnly.recoveryPart);
  check("恢复bad×负荷optimal → downgrade 而非最优区间绿", devOnly.level === "downgrade" || devOnly.level === "rest", devOnly.level);
  check("含手动自评差时恢复侧给负向证据", merged.recoveryPart !== null && merged.recoveryPart.length > 0, merged.recoveryPart);
}

// ---------- 4. readiness 黄金用例 ----------
console.log("[readiness 黄金用例]");
import { ACWR_ZONE_META, READY_ZONE_META } from "../src/lib/zone-meta";
function mkStatus(acwrZone: string | null, formValue: number | null, monoWarn = false, load7d = 300) {
  return {
    series: [], yesterdayLoad: 0,
    acwr: { value: acwrZone ? 1 : null, acute: null, chronic: null, zone: acwrZone, note: null },
    form: { value: formValue, fitness: null, fatigue: null, zone: formValue === null ? null : formValue > 5 ? "fresh" : formValue >= -10 ? "neutral" : "fatigued", note: null },
    weekly: { load7d, monotony: 1, strain: load7d, monotonyWarning: monoWarn },
    estimatedSessions: 0, totalSessions: load7d > 0 ? 5 : 0,
  } as unknown as ReturnType<typeof computeTrainingStatus>;
}
function mkScore(score: number | null) {
  return { score, zone: score === null ? null : score < 34 ? "red" : score < 67 ? "yellow" : "green",
    compositeZ: null, components: { hrv: { z: null, weight: .4, weightUsed: null }, restingHr: { z: null, weight: .3, weightUsed: null }, sleep: { z: null, weight: .3, weightUsed: null } },
    flags: [], note: null } as unknown as ReturnType<typeof computeRecoveryScore>;
}
{
  const r1 = computeReadiness(mkStatus("optimal", 0), mkScore(55));
  check("恢复ok×负荷最优 → normal", r1.level === "normal", r1.level);
  const r2 = computeReadiness(mkStatus("optimal", 0), mkScore(20));
  check("恢复bad×负荷最优 → 降档(用户场景)", r2.level === "downgrade", r2);
  const r3 = computeReadiness(mkStatus("risk", 0), mkScore(80));
  check("恢复good×负荷risk → 降档(拦截加练)", r3.level === "downgrade", r3.level);
  const r4 = computeReadiness(mkStatus("under", 0), mkScore(20));
  check("恢复bad×负荷build → 降档(没恢复不加量)", r4.level === "downgrade", r4.level);
  const r5 = computeReadiness(mkStatus("under", -15), mkScore(80));
  check("恢复good×build 但form疲劳 → normal", r5.level === "normal", `${r5.level}/${r5.loadPart}`);
  const r6 = computeReadiness(mkStatus("high", -15), mkScore(20));
  check("全坏 → rest", r6.level === "rest", r6.level);
  // 冷启动:恢复分 null + 睡眠 z=-1.4 → 恢复 low
  const cold = mkScore(null);
  (cold.components.sleep as { z: number | null }).z = -1.4;
  const r7 = computeReadiness(mkStatus("optimal", 0), cold);
  check("冷启动有负向信号 → 不装正常", r7.level === "downgrade", r7);
  const r8 = computeReadiness(mkStatus(null, null, false, 0), mkScore(null));
  check("两侧全空 → unknown", r8.level === "unknown", r8);
  const r9 = computeReadiness(mkStatus(null, null, true), mkScore(null));
  check("无 ACWR 有负荷+单调警告 → 有结论", r9.level !== "unknown", r9.level);
  check("ACWR 分区色仍有效", !!ACWR_ZONE_META.optimal);
  check("READY 五档元数据齐全", ["go_hard","normal","downgrade","rest","unknown"].every((l) => !!READY_ZONE_META[l as keyof typeof READY_ZONE_META]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
