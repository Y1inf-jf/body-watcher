// 项目回归测试(node:test)。运行:npm test
//
// 覆盖:恢复分/睡眠债口径、三档睡眠目标、手动录入合并、真实数据回放、
// readiness 黄金用例、LLM 配置合并优先级、登录失败限流。
//
// 为什么用 node:test 而不是 vitest/jest:Node 22 自带,零新增依赖;这些用例全是纯函数断言,
// 不需要 mock、DOM 或快照。TS 与"无扩展名导入"由 tsx 提供解析(见 package.json 的 test 脚本)。
//
// 写法约定:共享输入用工厂函数(每次调用重建),而不是模块级共享变量——这样每条 test 相互隔离,
// 一条失败不会污染另一条。
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { computeRecoveryFeatures, computeRecoveryScore, localDaysAgo } from "../src/lib/recovery";
import { computeTrainingStatus, computeSleepNeed } from "../src/lib/training-status";
import { computeReadiness, bandFromScore } from "../src/lib/readiness";
import { mergeManualHealth, latestManualSleepQuality } from "../src/lib/health-merge";
import { resolveLlmFrom } from "../src/lib/llm";
import { ACWR_ZONE_META, READY_ZONE_META } from "../src/lib/zone-meta";
import {
  clearLoginFailures,
  recordLoginFailure,
  resetLoginThrottle,
  throttleRemainingMs,
} from "../src/lib/login-throttle";
import type { GoogleMetricRow, TrainingLogRow } from "../src/lib/recovery";
import { parseExerciseSession, sessionsFromRawPayloads, type ExerciseSession } from "../src/lib/google/exercise-metrics";
import { correctDurations, extraActivities, type ExtraActivity } from "../src/lib/session-merge";
import { computeLoadContext, illnessSignalDays, shiftDate } from "../src/lib/load-context";
import type { DailyLoadPoint } from "../src/lib/training-status";

function sleepRow(
  date: string,
  inBed: number | null,
  awake: number | null = 0,
  hrv: number | null = null,
  rhr: number | null = null
): GoogleMetricRow {
  return { date, sleep_in_bed_minutes: inBed, sleep_awake_minutes: awake, hrv_rmssd_deep_ms: hrv, resting_hr: rhr };
}

describe("睡眠债口径", () => {
  // 近 7 晚实际睡眠 ~480,昨晚在床 470 但醒 90 → 实际 380 → 债 ≈100(旧口径:在床 470,债为负)
  const worstLastNight = () =>
    computeRecoveryFeatures([
      sleepRow("2026-09-01", 480), sleepRow("2026-09-02", 480), sleepRow("2026-09-03", 480),
      sleepRow("2026-09-04", 480), sleepRow("2026-09-05", 480), sleepRow("2026-09-06", 480),
      sleepRow("2026-09-07", 480),
      sleepRow("2026-09-08", 470, 90),
    ]);

  test("债务>0(旧口径会算出盈余)", () => {
    const debt = worstLastNight().sleep.debtMinutes;
    assert.ok(debt !== null && debt > 60, `debt=${debt}`);
  });

  test("实际睡眠字段存在", () => {
    assert.equal(worstLastNight().sleep.lastNight.asleepMinutes, 380);
  });

  // 取两晚中较差的:昨晚 480 达标,但前晚(倒数第二天)只睡 360 → 债按前晚算
  const worstPrevNight = () =>
    computeRecoveryFeatures([
      sleepRow("2026-08-28", 480), sleepRow("2026-08-29", 480), sleepRow("2026-08-30", 480),
      sleepRow("2026-08-31", 480), sleepRow("2026-09-01", 480), sleepRow("2026-09-02", 480),
      sleepRow("2026-09-03", 480), sleepRow("2026-09-04", 480), sleepRow("2026-09-05", 480),
      sleepRow("2026-09-06", 480), sleepRow("2026-09-07", 360, 0), sleepRow("2026-09-08", 480, 0),
    ]);

  // 加权口径:昨晚 480 达标、前晚 360 → 按 ⅓ 计入;近 7 晚均值 ≈463 → 债 ≈23(旧口径取最差一晚 >90)
  test("前晚差 → 按 ⅓ 计入(债 15–30)", () => {
    const debt = worstPrevNight().sleep.debtMinutes;
    assert.ok(debt !== null && debt >= 15 && debt <= 30, `debt=${debt}`);
  });

  test("连续两晚都差 → 债按两晚计(≈100)", () => {
    const rows = [
      ...Array.from({ length: 7 }, (_, i) => sleepRow(`2026-09-0${i + 1}`, 480)),
      sleepRow("2026-09-08", 380), sleepRow("2026-09-09", 380),
    ];
    const debt = computeRecoveryFeatures(rows).sleep.debtMinutes;
    // 近 7 晚(09-02..09-08)均值 = (6×480+380)/7 ≈ 466 → 466 − 380 = 86
    assert.ok(debt !== null && debt >= 80 && debt <= 90, `debt=${debt}`);
  });

  test("两晚都不低于均值 → 不记债(旧口径取较差一晚会偏大)", () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, i) => sleepRow(`2026-09-0${i + 1}`, i % 2 ? 460 : 500)),
      sleepRow("2026-09-07", 460), sleepRow("2026-09-08", 500),
    ];
    // 近 7 晚(09-01..09-07)均值 = (3×500+4×460)/7 ≈ 477;加权 = (2×500+460)/3 ≈ 487 → 债 ≈ −10
    const debt = computeRecoveryFeatures(rows).sleep.debtMinutes;
    assert.ok(debt !== null && debt <= 0, `debt=${debt}`);
  });

  test("正常睡眠债≈0", () => {
    const rows = Array.from({ length: 8 }, (_, i) => sleepRow(`2026-09-0${i + 1}`, 480, 0, 50, 60));
    const debt = computeRecoveryFeatures(rows).sleep.debtMinutes;
    assert.ok(Math.abs(debt ?? 99) <= 5, `debt=${debt}`);
  });
});

describe("三档睡眠目标", () => {
  // 两晚差睡眠(380)混在好觉里:均值参照被拉低,min 目标把参照线抬回 500
  const targetRows = (): GoogleMetricRow[] => [
    sleepRow("2026-09-01", 480), sleepRow("2026-09-02", 480), sleepRow("2026-09-03", 480),
    sleepRow("2026-09-04", 480), sleepRow("2026-09-05", 480), sleepRow("2026-09-06", 480, 100),
    sleepRow("2026-09-07", 480, 100), sleepRow("2026-09-08", 480),
  ];
  const withMin = (minMinutes: number) =>
    computeRecoveryFeatures(targetRows(), {
      sleepTargets: { minMinutes, targetMinutes: null, idealMinutes: null },
    });

  test("min>均值 → 参照线抬高、债务更大", () => {
    const noMin = computeRecoveryFeatures(targetRows()).sleep.debtMinutes;
    const raised = withMin(500).sleep.debtMinutes;
    assert.ok((raised ?? 0) > (noMin ?? 0), `noMin=${noMin} withMin=${raised}`);
  });

  test("参照线回显为目标值", () => {
    assert.equal(withMin(500).sleep.debtRefMinutes, 500);
  });

  test("min<均值 → 目标不拉低参照", () => {
    const noMin = computeRecoveryFeatures(targetRows()).sleep.debtMinutes;
    assert.equal(withMin(300).sleep.debtMinutes, noMin);
  });

  // 冷启动只有一晚:无目标算不了债,设了 min 就能算
  const coldRows = (): GoogleMetricRow[] => [sleepRow("2026-09-08", 400, 40)]; // 实际 360

  test("冷启动无目标 → 债为 null", () => {
    assert.equal(computeRecoveryFeatures(coldRows()).sleep.debtMinutes, null);
  });

  test("冷启动设 min=450 → 债 90", () => {
    const debt = computeRecoveryFeatures(coldRows(), {
      sleepTargets: { minMinutes: 450, targetMinutes: null, idealMinutes: null },
    }).sleep.debtMinutes;
    assert.equal(debt, 90);
  });

  // 今晚建议:target 抬地板、ideal 封顶
  const goodSleep = () =>
    computeRecoveryFeatures(Array.from({ length: 8 }, (_, i) => sleepRow(`2026-09-0${i + 1}`, 480, 0))).sleep;

  test("无目标地板=均值", () => {
    const need = computeSleepNeed(goodSleep(), 0);
    assert.ok(need?.base === 480 && need.baseSource === "avg7d", JSON.stringify(need));
  });

  test("target 抬高地板", () => {
    const need = computeSleepNeed(goodSleep(), 0, { targetMinutes: 510 });
    assert.ok(need?.base === 510 && need.baseSource === "target", JSON.stringify(need));
  });

  test("target 低于均值不降地板", () => {
    const need = computeSleepNeed(goodSleep(), 0, { targetMinutes: 450 });
    assert.ok(need?.baseSource === "avg7d" && need.base === 480, JSON.stringify(need));
  });

  test("ideal 封顶生效", () => {
    const bad: GoogleMetricRow[] = [
      ...Array.from({ length: 6 }, (_, i) => sleepRow(`2026-09-0${i + 1}`, 480, 0)),
      sleepRow("2026-09-07", 480, 100), sleepRow("2026-09-08", 480),
    ];
    const need = computeSleepNeed(computeRecoveryFeatures(bad).sleep, 300, {
      targetMinutes: 480,
      idealMinutes: 490,
    });
    assert.equal(need?.minutes, 490);
  });
});

describe("手动录入合并", () => {
  const device = (): GoogleMetricRow[] => [
    { date: "2026-09-07", sleep_in_bed_minutes: null } as GoogleMetricRow,
  ];
  const manual = () => [
    { date: "2026-09-06", sleep_hours: 7, hrv: 55, resting_hr: 58, sleep_quality: 8 },
    { date: "2026-09-07", sleep_hours: 6.5, sleep_quality: 4 },
  ];

  test("手动行被补进且升序", () => {
    const merged = mergeManualHealth(device(), manual());
    assert.ok(merged.length === 2 && merged[0].date === "2026-09-06", merged.map((r) => r.date).join(","));
  });

  test("sleep_hours 换算在床分钟", () => {
    const merged = mergeManualHealth(device(), manual());
    assert.equal(merged.find((r) => r.date === "2026-09-07")!.sleep_in_bed_minutes, 390);
  });

  // 相对日期:latestManualSleepQuality 按"昨天起"过滤,写死绝对日期会随时间腐化
  // (原用例写 2026-09-01/09-07,过了 09-09 就必然失败)。
  test("自评只取近两晚", () => {
    const q = latestManualSleepQuality([
      { date: localDaysAgo(9), sleep_quality: 2 },
      { date: localDaysAgo(1), sleep_quality: 4 },
    ]);
    assert.equal(q, 4);
  });

  test("过期自评被忽略", () => {
    assert.equal(latestManualSleepQuality([{ date: localDaysAgo(9), sleep_quality: 2 }]), null);
  });

  test("设备已有值不被手动覆盖", () => {
    const merged = mergeManualHealth(
      [{ date: "2026-09-07", sleep_in_bed_minutes: 500 } as GoogleMetricRow],
      [{ date: "2026-09-07", sleep_hours: 6 }]
    );
    assert.equal(merged[0].sleep_in_bed_minutes, 500);
  });
});

describe("真实数据回放(服务器 2026-08-28..09-07)", () => {
  const google = (): GoogleMetricRow[] =>
    [
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

  const logs = (): TrainingLogRow[] =>
    [
      { date: "2026-09-07", duration: 56, rpe: 8 }, { date: "2026-09-04", duration: 60, rpe: 8 },
      { date: "2026-09-02", duration: 53, rpe: 8 }, { date: "2026-08-30", duration: 52, rpe: 8 },
      { date: "2026-08-28", duration: 41, rpe: 8 },
    ] as TrainingLogRow[];

  const deviceOnly = () =>
    computeReadiness(computeTrainingStatus(logs()), computeRecoveryScore(computeRecoveryFeatures(google())));

  const withManual = () =>
    computeReadiness(
      computeTrainingStatus(logs()),
      computeRecoveryScore(
        computeRecoveryFeatures(
          mergeManualHealth(google(), [
            { date: "2026-09-06", sleep_hours: 6.3, sleep_quality: 3 },
            { date: "2026-09-07", sleep_hours: 8, sleep_quality: 6 },
          ])
        )
      ),
      { manualSleepQuality: 6 }
    );

  test("设备数据基线已就绪 → 恢复分出结论(25分档)", () => {
    const part = deviceOnly().recoveryPart;
    assert.ok(part !== null && /恢复分/.test(part), String(part));
  });

  test("恢复bad×负荷optimal → downgrade 而非最优区间绿", () => {
    const level = deviceOnly().level;
    assert.ok(level === "downgrade" || level === "rest", level);
  });

  test("含手动自评差时恢复侧给负向证据", () => {
    const part = withManual().recoveryPart;
    assert.ok(part !== null && part.length > 0, String(part));
  });
});

describe("睡眠体温偏差", () => {
  // 基线直接用设备给的 30 天中位数(temp_baseline_c),不做二次基线;
  // 偏差 = 夜间 − 基线,≥1°C 打旗标(压恢复分到黄档),缺失字段不出偏差。
  test("偏差 = 夜间 − 设备基线,保留 1 位小数", () => {
    const f = computeRecoveryFeatures([
      { date: "2026-09-13", temp_night_c: 32.5, temp_baseline_c: 32.3 },
      { date: "2026-09-14", temp_night_c: 33.22, temp_baseline_c: 32.33 },
    ]);
    assert.equal(f.temp.nightC, 33.22);
    assert.equal(f.temp.baselineC, 32.33);
    assert.equal(f.temp.deviationC, 0.9);
  });

  test("偏差 ≥1°C → 恢复分带皮肤温度旗标", () => {
    const f = computeRecoveryFeatures([
      { date: "2026-09-14", temp_night_c: 33.4, temp_baseline_c: 32.3 },
    ]);
    const score = computeRecoveryScore(f);
    assert.ok(score.flags.some((s) => /皮肤温度偏高/.test(s)), JSON.stringify(score.flags));
  });

  test("偏差 <1°C → 不打旗标", () => {
    const score = computeRecoveryScore(
      computeRecoveryFeatures([{ date: "2026-09-14", temp_night_c: 32.8, temp_baseline_c: 32.3 }])
    );
    assert.ok(!score.flags.some((s) => /皮肤温度/.test(s)), JSON.stringify(score.flags));
  });

  test("夜间或基线缺失 → 偏差为 null,不误报", () => {
    const f = computeRecoveryFeatures([
      { date: "2026-09-13", temp_night_c: 32.5 },
      { date: "2026-09-14" },
    ]);
    assert.equal(f.temp.deviationC, null);
    assert.equal(computeRecoveryScore(f).flags.some((s) => /皮肤温度/.test(s)), false);
  });
});

function mkStatus(acwrZone: string | null, formValue: number | null, monoWarn = false, load7d = 300) {
  return {
    series: [],
    yesterdayLoad: 0,
    acwr: { value: acwrZone ? 1 : null, acute: null, chronic: null, zone: acwrZone, note: null },
    form: {
      value: formValue,
      fitness: null,
      fatigue: null,
      zone: formValue === null ? null : formValue > 5 ? "fresh" : formValue >= -10 ? "neutral" : "fatigued",
      note: null,
    },
    weekly: { load7d, monotony: 1, strain: load7d, monotonyWarning: monoWarn },
    estimatedSessions: 0,
    totalSessions: load7d > 0 ? 5 : 0,
    allSessionsEstimated: false,
    durationCorrected: 0,
    extraActivities: [],
  } as unknown as ReturnType<typeof computeTrainingStatus>;
}

function mkScore(score: number | null) {
  return {
    score,
    zone: score === null ? null : score < 34 ? "red" : score < 67 ? "yellow" : "green",
    compositeZ: null,
    components: {
      hrv: { z: null, weight: 0.4, weightUsed: null },
      restingHr: { z: null, weight: 0.3, weightUsed: null },
      sleep: { z: null, weight: 0.3, weightUsed: null },
    },
    flags: [],
    note: null,
    drag: null,
  } as unknown as ReturnType<typeof computeRecoveryScore>;
}

describe("readiness 黄金用例", () => {
  test("恢复ok×负荷最优 → normal", () => {
    assert.equal(computeReadiness(mkStatus("optimal", 0), mkScore(55)).level, "normal");
  });

  test("恢复bad×负荷最优 → 降档(用户场景)", () => {
    assert.equal(computeReadiness(mkStatus("optimal", 0), mkScore(20)).level, "downgrade");
  });

  test("恢复good×负荷risk → 降档(拦截加练)", () => {
    assert.equal(computeReadiness(mkStatus("risk", 0), mkScore(80)).level, "downgrade");
  });

  test("恢复bad×负荷build → 降档(没恢复不加量)", () => {
    assert.equal(computeReadiness(mkStatus("under", 0), mkScore(20)).level, "downgrade");
  });

  test("恢复good×build 但form疲劳 → normal", () => {
    const r = computeReadiness(mkStatus("under", -15), mkScore(80));
    assert.equal(r.level, "normal", `${r.level}/${r.loadPart}`);
  });

  test("无 RPE 模式不因估算欠训练而建议冲强度", () => {
    const status = mkStatus("under", 0);
    status.allSessionsEstimated = true;
    assert.equal(computeReadiness(status, mkScore(80)).level, "normal");
  });

  test("全坏 → rest", () => {
    assert.equal(computeReadiness(mkStatus("high", -15), mkScore(20)).level, "rest");
  });

  test("冷启动有负向信号 → 不装正常", () => {
    // 恢复分 null + 睡眠 z=-1.4 → 恢复 low
    const cold = mkScore(null);
    (cold.components.sleep as { z: number | null }).z = -1.4;
    assert.equal(computeReadiness(mkStatus("optimal", 0), cold).level, "downgrade");
  });

  test("两侧全空 → unknown", () => {
    assert.equal(computeReadiness(mkStatus(null, null, false, 0), mkScore(null)).level, "unknown");
  });

  test("无 ACWR 有负荷+单调警告 → 有结论", () => {
    assert.notEqual(computeReadiness(mkStatus(null, null, true), mkScore(null)).level, "unknown");
  });

  test("ACWR 分区色仍有效", () => {
    assert.ok(!!ACWR_ZONE_META.optimal);
  });

  test("READY 五档元数据齐全", () => {
    const levels = ["go_hard", "normal", "downgrade", "rest", "unknown"] as const;
    assert.ok(levels.every((l) => !!READY_ZONE_META[l]), levels.join(","));
  });
});

describe("LLM 配置合并优先级", () => {
  const none = { model: null, baseUrl: null, apiKey: null };

  test("全空 → 内置默认 + Key 未配置", () => {
    const r = resolveLlmFrom(none, {});
    assert.ok(
      r.model === "qwen3.8-flash" && r.source.apiKey === "none" && r.baseUrl.includes("dashscope"),
      JSON.stringify(r)
    );
  });

  test("DB 空 → 回落 env", () => {
    const r = resolveLlmFrom(none, { LLM_MODEL: "deepseek-v3", LLM_API_KEY: "sk-env" });
    assert.ok(r.model === "deepseek-v3" && r.apiKey === "sk-env" && r.source.model === "env", JSON.stringify(r));
  });

  test("DB 逐项覆盖 env", () => {
    const r = resolveLlmFrom(
      { model: "glm-4.6", baseUrl: null, apiKey: "sk-db" },
      { LLM_MODEL: "deepseek-v3", LLM_API_KEY: "sk-env" }
    );
    assert.ok(r.model === "glm-4.6" && r.apiKey === "sk-db" && r.source.apiKey === "db", JSON.stringify(r));
  });

  test("未设的 baseUrl 各自回落", () => {
    const r = resolveLlmFrom(
      { model: "glm-4.6", baseUrl: null, apiKey: "sk-db" },
      { LLM_MODEL: "deepseek-v3", LLM_API_KEY: "sk-env" }
    );
    assert.ok(r.source.baseUrl === "default" && r.baseUrl.startsWith("https://dashscope"), JSON.stringify(r.source));
  });
});

describe("登录失败限流(递进退避)", () => {
  const T0 = 1_700_000_000_000;
  const MIN = 60_000;

  test("阶梯:3 次锁 30s → 5 次锁 5min → 8 次锁 30min,其他 IP 不受牵连", () => {
    resetLoginThrottle();
    assert.equal(throttleRemainingMs("1.1.1.1", T0), 0, "无记录应不限流");
    assert.equal(recordLoginFailure("1.1.1.1", T0), 0, "第1次不触发阶梯");
    assert.equal(recordLoginFailure("1.1.1.1", T0 + 1000), 0, "第2次不触发阶梯");
    assert.equal(recordLoginFailure("1.1.1.1", T0 + 2000), 30_000, "第3次应锁 30s");
    assert.ok(throttleRemainingMs("1.1.1.1", T0 + 3000) > 0, "锁定期内应有剩余");
    assert.equal(throttleRemainingMs("1.1.1.1", T0 + 2000 + 30_000), 0, "窗口过后应自动解除");
    recordLoginFailure("1.1.1.1", T0 + 40_000); // 第4次
    assert.equal(recordLoginFailure("1.1.1.1", T0 + 41_000), 5 * MIN, "第5次应升级为 5 分钟");
    recordLoginFailure("1.1.1.1", T0 + 42_000); // 第6次
    recordLoginFailure("1.1.1.1", T0 + 43_000); // 第7次
    assert.equal(recordLoginFailure("1.1.1.1", T0 + 44_000), 30 * MIN, "第8次应升级为 30 分钟");
    assert.equal(throttleRemainingMs("2.2.2.2", T0 + 45_000), 0, "其他 IP 不受牵连");
    resetLoginThrottle();
  });

  test("登录成功清零", () => {
    resetLoginThrottle();
    recordLoginFailure("1.1.1.1", T0);
    recordLoginFailure("1.1.1.1", T0 + 1000);
    recordLoginFailure("1.1.1.1", T0 + 2000); // 触发 30s 锁
    clearLoginFailures("1.1.1.1");
    assert.equal(throttleRemainingMs("1.1.1.1", T0 + 3000), 0, "成功后应立即解除");
    assert.equal(recordLoginFailure("1.1.1.1", T0 + 4000), 0, "清零后计数应从头算");
    resetLoginThrottle();
  });

  // 累积语义:锁定解除后再失败一次,会按同一档重新计时(而不是回到"免费 3 次")
  test("计数为累积制:锁定解除后再失败仍按该档重新计时", () => {
    resetLoginThrottle();
    recordLoginFailure("4.4.4.4", T0);
    recordLoginFailure("4.4.4.4", T0 + 1000);
    assert.equal(recordLoginFailure("4.4.4.4", T0 + 2000), 30_000, "第3次锁 30s");
    assert.equal(throttleRemainingMs("4.4.4.4", T0 + 2000 + 30_000), 0, "窗口刚过时可再试");
    assert.equal(recordLoginFailure("4.4.4.4", T0 + 2000 + 31_000), 30_000, "再失败仍按 30s 档重新计时");
    assert.ok(throttleRemainingMs("4.4.4.4", T0 + 2000 + 32_000) > 0, "计数未清零,重新进入锁定");
    resetLoginThrottle();
  });

  test("TTL 过期后计数重置", () => {
    resetLoginThrottle();
    recordLoginFailure("3.3.3.3", T0);
    recordLoginFailure("3.3.3.3", T0 + 1000);
    recordLoginFailure("3.3.3.3", T0 + 2000); // 触发 30s 锁
    const later = T0 + 2000 + 60 * MIN + 1000; // 锁定已过 + 一小时无失败
    const w1 = recordLoginFailure("3.3.3.3", later);
    const w2 = recordLoginFailure("3.3.3.3", later + 1000);
    const w3 = recordLoginFailure("3.3.3.3", later + 2000);
    assert.deepEqual([w1, w2, w3], [0, 0, 30_000], "应仍是第3次才锁 30s(计数已重置)");
    resetLoginThrottle();
  });
});

// 从起始日往后推 n 天(测试用,本地日历口径)。
function dayAfter(start: string, n: number): string {
  const d = new Date(`${start}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("鲁棒基线", () => {
  // 20 天正常(HRV 48/52 交替、RHR 70)中间夹 4 天病中(HRV 25、RHR 80),今天单独给
  const withSickDays = (todayHrv: number, todayRhr: number): GoogleMetricRow[] => {
    const rows: GoogleMetricRow[] = [];
    for (let i = 0; i < 24; i++) {
      const sick = i >= 10 && i < 14;
      rows.push({ date: dayAfter("2026-08-01", i), hrv_avg_ms: sick ? 25 : i % 2 ? 48 : 52, resting_hr: sick ? 80 : 70 });
    }
    rows.push({ date: dayAfter("2026-08-01", 24), hrv_avg_ms: todayHrv, resting_hr: todayRhr });
    return rows;
  };
  const flat = (n: number, hrv: number, rhr: number, todayHrv: number, todayRhr: number): GoogleMetricRow[] => [
    ...Array.from({ length: n }, (_, i) => ({ date: dayAfter("2026-08-01", i), hrv_avg_ms: hrv, resting_hr: rhr })),
    { date: dayAfter("2026-08-01", n), hrv_avg_ms: todayHrv, resting_hr: todayRhr },
  ];

  test("病中极端日不把 HRV 基线拉偏", () => {
    const f = computeRecoveryFeatures(withSickDays(38, 70));
    assert.ok(f.hrv.baselineMean !== null && f.hrv.baselineMean >= 47 && f.hrv.baselineMean <= 53, String(f.hrv.baselineMean));
  });

  test("病中极端日不把 HRV 离散拉宽:今天 38 仍明显偏低", () => {
    const z = computeRecoveryFeatures(withSickDays(38, 70)).hrv.zScore;
    assert.ok(z !== null && z < -1.5, `z=${z}`);
  });

  test("RHR 基线取中位数,病中 80 不影响", () => {
    const f = computeRecoveryFeatures(withSickDays(50, 70));
    assert.equal(f.restingHr.baselineMean, 70);
    assert.equal(f.restingHr.zScore, 0);
  });

  test("RHR 离散下限 2 bpm:全 70 的池子,今天 72 → 分项 z = −1", () => {
    const f = computeRecoveryFeatures(flat(10, 50, 70, 50, 72));
    assert.equal(f.restingHr.zScore, 1);
    assert.equal(computeRecoveryScore(f).components.restingHr.z, -1);
  });

  test("ln HRV 离散下限 0.08:全 50 的池子,今天 46 → z ≈ −1.04", () => {
    assert.equal(computeRecoveryFeatures(flat(10, 50, 70, 46, 70)).hrv.zScore, -1.04);
  });

  test("HRV 分项 z 夹在 −3", () => {
    const score = computeRecoveryScore(computeRecoveryFeatures(flat(10, 50, 70, 20, 70)));
    assert.equal(score.components.hrv.z, -3);
  });

  test("HRV 基线回显单位仍是 ms", () => {
    assert.equal(computeRecoveryFeatures(flat(10, 50, 70, 50, 70)).hrv.baselineMean, 50);
  });
});

describe("主要拖累项与新门槛", () => {
  const rows = (todayHrv: number | null, todayRhr: number): GoogleMetricRow[] => [
    ...Array.from({ length: 10 }, (_, i) => ({
      date: dayAfter("2026-08-01", i), hrv_avg_ms: 50, resting_hr: 70, sleep_in_bed_minutes: 480, sleep_awake_minutes: 0,
    })),
    { date: dayAfter("2026-08-01", 10), hrv_avg_ms: todayHrv, resting_hr: todayRhr, sleep_in_bed_minutes: 480, sleep_awake_minutes: 0 },
  ];

  test("静息心率高 6 bpm → 拖累项为静息心率", () => {
    const score = computeRecoveryScore(computeRecoveryFeatures(rows(50, 76)));
    assert.equal(score.drag?.key, "restingHr");
    assert.equal(score.drag?.text, "静息心率比基线高 6 bpm");
  });

  test("HRV 低 → 拖累项文案给百分比", () => {
    const score = computeRecoveryScore(computeRecoveryFeatures(rows(40, 70)));
    assert.equal(score.drag?.key, "hrv");
    assert.equal(score.drag?.text, "HRV 低于基线 20%");
  });

  test("各项都在基线 → 无拖累项", () => {
    assert.equal(computeRecoveryScore(computeRecoveryFeatures(rows(50, 70))).drag, null);
  });

  test("今天没戴手环缺 HRV → 仍出分,拖累项不选 HRV", () => {
    const score = computeRecoveryScore(computeRecoveryFeatures(rows(null, 76)));
    assert.ok(score.score !== null);
    assert.equal(score.drag?.key, "restingHr");
  });

  test("门槛:33 bad / 34 ok / 50 有旗标 low / 66 ok / 67 good", () => {
    assert.equal(bandFromScore(33, false), "bad");
    assert.equal(bandFromScore(34, false), "ok");
    assert.equal(bandFromScore(50, true), "low");
    assert.equal(bandFromScore(66, false), "ok");
    assert.equal(bandFromScore(67, false), "good");
  });

  test("恢复分 45 无旗标 × 负荷最优 → 正常练(不再降档)", () => {
    assert.equal(computeReadiness(mkStatus("optimal", 0), mkScore(45)).level, "normal");
  });
});

// 真实 payload 形状(2026-09-23 Fitbit Air 健力会话,用户 ID 已脱敏)
const workoutPayload = () => ({
  name: "users/me/dataTypes/exercise/dataPoints/1",
  dataSource: { recordingMethod: "ACTIVELY_MEASURED", device: { formFactor: "FITNESS_BAND" }, platform: "FITBIT" },
  exercise: {
    interval: { startTime: "2026-09-23T04:18:04Z", startUtcOffset: "28800s", endTime: "2026-09-23T05:10:24Z", endUtcOffset: "28800s" },
    exerciseType: "WORKOUT",
    metricsSummary: {
      caloriesKcal: 272, averageHeartRateBeatsPerMinute: "124",
      heartRateZoneDurations: { lightTime: "1320s", moderateTime: "1800s", vigorousTime: "0s", peakTime: "0s" },
    },
    activeDuration: "3136.124s",
  },
});

function mkSession(p: Partial<ExerciseSession> & Pick<ExerciseSession, "date" | "startTime" | "endTime" | "exerciseType">): ExerciseSession {
  return {
    id: `${p.date}-${p.startTime}`, recordingMethod: "PASSIVELY_MEASURED", activeMinutes: 0,
    zoneLightS: 0, zoneModerateS: 0, zoneVigorousS: 0, zonePeakS: 0, avgHr: null, ...p,
  };
}

// 9/19 打球:07:24 有氧 20 分钟接 07:44 球类 61 分钟;骑车去球场 06:51–07:18
const ballDay = (): ExerciseSession[] => [
  mkSession({ date: "2026-09-19", exerciseType: "BIKING", startTime: "2026-09-19T06:51:00Z", endTime: "2026-09-19T07:18:00Z", activeMinutes: 26.6 }),
  mkSession({ date: "2026-09-19", exerciseType: "CARDIO_WORKOUT", startTime: "2026-09-19T07:24:00Z", endTime: "2026-09-19T07:44:10Z", activeMinutes: 20.2, zoneModerateS: 360, zoneVigorousS: 840 }),
  mkSession({ date: "2026-09-19", exerciseType: "SPORT", startTime: "2026-09-19T07:44:30Z", endTime: "2026-09-19T08:45:10Z", activeMinutes: 60.6, zoneModerateS: 2040, zoneVigorousS: 900 }),
];

describe("手环运动会话", () => {
  test("解析手动开启的 WORKOUT", () => {
    const s = parseExerciseSession(workoutPayload());
    assert.ok(s);
    assert.equal(s.date, "2026-09-23");
    assert.equal(s.exerciseType, "WORKOUT");
    assert.equal(s.recordingMethod, "ACTIVELY_MEASURED");
    assert.equal(s.activeMinutes, 52.3);
    assert.equal(s.zoneModerateS, 1800);
    assert.equal(s.avgHr, 124);
  });

  test("被动识别会话缺 metricsSummary → 四区记 0、心率 null,不抛错", () => {
    const p = workoutPayload() as Record<string, unknown>;
    const ex = { ...(p.exercise as Record<string, unknown>), exerciseType: "WALKING" } as Record<string, unknown>;
    delete ex.metricsSummary;
    const s = parseExerciseSession({ ...p, dataSource: { recordingMethod: "PASSIVELY_MEASURED" }, exercise: ex });
    assert.ok(s);
    assert.equal(s.zoneModerateS, 0);
    assert.equal(s.avgHr, null);
  });

  test("原始快照含损坏 JSON → 跳过该行,其余照常", () => {
    const sessions = sessionsFromRawPayloads(["{not json", JSON.stringify([workoutPayload()])]);
    assert.equal(sessions.length, 1);
  });

  test("时长修正:单条训练取手环 WORKOUT 时长", () => {
    const logs: TrainingLogRow[] = [{ date: "2026-09-23", duration: 12 }];
    const sessions = [mkSession({ date: "2026-09-23", exerciseType: "WORKOUT", recordingMethod: "ACTIVELY_MEASURED", startTime: "2026-09-23T04:18:04Z", endTime: "2026-09-23T05:10:24Z", activeMinutes: 52.3 })];
    const [out] = correctDurations(logs, sessions);
    assert.equal(out.duration, 52);
    assert.equal(out.durationSource, "wearable");
  });

  test("时长修正:训记更长时保留训记", () => {
    const logs: TrainingLogRow[] = [{ date: "2026-09-09", duration: 46 }];
    const sessions = [mkSession({ date: "2026-09-09", exerciseType: "WORKOUT", recordingMethod: "ACTIVELY_MEASURED", startTime: "2026-09-09T10:31:00Z", endTime: "2026-09-09T11:17:00Z", activeMinutes: 45.6 })];
    assert.equal(correctDurations(logs, sessions)[0].duration, 46);
  });

  test("时长修正:同日多条训练不改", () => {
    const logs: TrainingLogRow[] = [{ date: "2026-09-23", duration: 12 }, { date: "2026-09-23", duration: 10 }];
    const sessions = [mkSession({ date: "2026-09-23", exerciseType: "WORKOUT", recordingMethod: "ACTIVELY_MEASURED", startTime: "2026-09-23T04:18:04Z", endTime: "2026-09-23T05:10:24Z", activeMinutes: 52.3 })];
    assert.deepEqual(correctDurations(logs, sessions).map((l) => l.duration), [12, 10]);
  });

  test("时长修正:被动识别的 WORKOUT 不算", () => {
    const logs: TrainingLogRow[] = [{ date: "2026-09-23", duration: 12 }];
    const sessions = [mkSession({ date: "2026-09-23", exerciseType: "WORKOUT", startTime: "2026-09-23T04:18:04Z", endTime: "2026-09-23T05:10:24Z", activeMinutes: 52.3 })];
    assert.equal(correctDurations(logs, sessions)[0].duration, 12);
  });

  test("额外活动:9/19 打球合并计入,负荷为心率负荷的一半,骑车排除", () => {
    const acts = extraActivities(ballDay());
    assert.equal(acts.length, 1);
    assert.equal(acts[0].date, "2026-09-19");
    assert.equal(acts[0].minutes, 81);
    assert.equal(acts[0].label, "球类");
    // hrLoadAu(0, 2400, 1740, 0) = (2400×2 + 1740×3)/60 = 167 → ×0.5
    assert.equal(acts[0].load, 83.5);
  });

  test("额外活动:9/13 有氧中强度 19 分钟不计入", () => {
    const acts = extraActivities([
      mkSession({ date: "2026-09-13", exerciseType: "CARDIO_WORKOUT", startTime: "2026-09-13T07:08:00Z", endTime: "2026-09-13T07:30:00Z", activeMinutes: 22.1, zoneModerateS: 1140 }),
    ]);
    assert.equal(acts.length, 0);
  });

  test("额外活动:9/5 跑步 14 分钟不计入", () => {
    const acts = extraActivities([
      mkSession({ date: "2026-09-05", exerciseType: "RUNNING", recordingMethod: "ACTIVELY_MEASURED", startTime: "2026-09-05T11:00:00Z", endTime: "2026-09-05T11:14:12Z", activeMinutes: 14.2, zoneModerateS: 180, zoneVigorousS: 660 }),
    ]);
    assert.equal(acts.length, 0);
  });

  test("额外活动:间隔超过 10 分钟的两段不合并", () => {
    const acts = extraActivities([
      mkSession({ date: "2026-09-19", exerciseType: "SPORT", startTime: "2026-09-19T07:00:00Z", endTime: "2026-09-19T07:25:00Z", activeMinutes: 25, zoneModerateS: 1200 }),
      mkSession({ date: "2026-09-19", exerciseType: "SPORT", startTime: "2026-09-19T07:40:00Z", endTime: "2026-09-19T08:05:00Z", activeMinutes: 25, zoneModerateS: 1200 }),
    ]);
    assert.equal(acts.length, 0); // 各 20 分钟中强度,单独都不足 30 分钟
  });
});

describe("训练状态接入手环会话", () => {
  const ball = (): ExtraActivity[] => [{ date: "2026-09-19", minutes: 81, load: 84, label: "球类" }];
  const lift = (): TrainingLogRow[] => [
    { date: "2026-09-21", duration: 32, durationSource: "wearable", exercises: [{ sets: 20 }] },
  ];

  test("额外活动按日计入负荷序列", () => {
    const s = computeTrainingStatus(lift(), { today: "2026-09-24", extraActivities: ball() });
    assert.equal(s.series.find((p) => p.date === "2026-09-19")?.load, 84);
    assert.equal(s.totalSessions, 2);
    assert.equal(s.extraActivities.length, 1);
  });

  test("额外活动不改变无 RPE 模式判定", () => {
    const s = computeTrainingStatus(lift(), { today: "2026-09-24", extraActivities: ball() });
    assert.equal(s.allSessionsEstimated, true);
  });

  test("统计时长被手环修正的训练次数", () => {
    assert.equal(computeTrainingStatus(lift(), { today: "2026-09-24" }).durationCorrected, 1);
  });

  test("窗口外的额外活动不计入", () => {
    const s = computeTrainingStatus([], { today: "2026-12-01", extraActivities: ball() });
    assert.equal(s.extraActivities.length, 0);
    assert.equal(s.totalSessions, 0);
  });
});

// 以 today 为终点、共 days 天的负荷序列;loads 以日期为键。
function mkSeries(today: string, days: number, loads: Record<string, number>): DailyLoadPoint[] {
  return Array.from({ length: days }, (_, i) => {
    const date = shiftDate(today, i - (days - 1));
    const load = loads[date] ?? 0;
    return { date, load, rpeUsed: null, estimated: false, sessions: load > 0 ? 1 : 0, estimatedSessions: 0 };
  });
}

// 病前每 3 天练一次、每次 50 AU(8/15..9/11 共 10 次 → 基准周负荷 125,首周上限 75);
// 9/12–9/18 停训(生病),9/19 打球 84,9/21 练 37,9/23 练 61
const preIllness = (): Record<string, number> => {
  const out: Record<string, number> = {};
  for (let i = 0; i < 10; i++) out[shiftDate("2026-08-15", i * 3)] = 50;
  return out;
};
const afterReturn = (): Record<string, number> => ({ ...preIllness(), "2026-09-19": 84, "2026-09-21": 37, "2026-09-23": 61 });
const sickRows = (): GoogleMetricRow[] => [
  ...Array.from({ length: 20 }, (_, i) => ({ date: shiftDate("2026-08-28", i), respiratory_rate: 16.4 })),
  { date: "2026-09-17", respiratory_rate: 18.2, temp_night_c: 33.54, temp_baseline_c: 32.3 },
  { date: "2026-09-18", respiratory_rate: 18.8 },
];

describe("生病信号", () => {
  test("呼吸率高于前 30 天中位数 1 次/分、体温高 1°C 都算信号日", () => {
    assert.deepEqual(illnessSignalDays(sickRows()), ["2026-09-17", "2026-09-18"]);
  });

  test("体温偏差 0.9 不算", () => {
    assert.deepEqual(illnessSignalDays([{ date: "2026-09-17", temp_night_c: 33.2, temp_baseline_c: 32.3 }]), []);
  });

  test("前序样本不足 5 天时不判呼吸率", () => {
    assert.deepEqual(illnessSignalDays([{ date: "2026-09-01", respiratory_rate: 16 }, { date: "2026-09-02", respiratory_rate: 20 }]), []);
  });
});

describe("回归期", () => {
  test("病后第 1 周:额度已用完只提示", () => {
    const ctx = computeLoadContext(mkSeries("2026-09-21", 63, afterReturn()), sickRows(), "2026-09-21");
    assert.equal(ctx.phase, "return");
    if (ctx.phase !== "return") return;
    assert.equal(ctx.reason, "illness");
    assert.equal(ctx.resumeDate, "2026-09-19");
    assert.equal(ctx.week, 1);
    assert.equal(ctx.weekLoad, 121);
    assert.equal(ctx.weekCap, 75);
    assert.ok(ctx.remaining !== null && ctx.remaining < 0);
    assert.match(ctx.note, /额度已用完/);
  });

  test("近 7 天负荷回到病前周均 → 退出回归期", () => {
    const ctx = computeLoadContext(mkSeries("2026-09-24", 63, afterReturn()), sickRows(), "2026-09-24");
    assert.equal(ctx.phase, "normal");
  });

  test("只有停训没有生病信号 → reason=gap", () => {
    const ctx = computeLoadContext(mkSeries("2026-09-21", 63, { ...preIllness(), "2026-09-21": 20 }), [], "2026-09-21");
    assert.equal(ctx.phase, "return");
    if (ctx.phase === "return") assert.equal(ctx.reason, "gap");
  });

  test("停训仍在持续 → week=0、resumeDate=null,给首周上限", () => {
    const ctx = computeLoadContext(mkSeries("2026-09-20", 63, preIllness()), [], "2026-09-20");
    assert.equal(ctx.phase, "return");
    if (ctx.phase !== "return") return;
    assert.equal(ctx.week, 0);
    assert.equal(ctx.resumeDate, null);
    assert.equal(ctx.weekCap, 75);
    assert.match(ctx.note, /尚未恢复训练/);
  });

  test("恢复训练满 21 天 → 退出;第 20 天仍在第 3 周", () => {
    const loads: Record<string, number> = { ...preIllness() };
    for (let i = 0; i <= 21; i += 3) loads[shiftDate("2026-09-19", i)] = 10;
    const day20 = computeLoadContext(mkSeries("2026-10-09", 63, loads), [], "2026-10-09");
    assert.equal(day20.phase, "return");
    if (day20.phase === "return") assert.equal(day20.week, 3);
    assert.equal(computeLoadContext(mkSeries("2026-10-10", 63, loads), [], "2026-10-10").phase, "normal");
  });

  test("单日生病信号、无停训 → 不进回归期", () => {
    const loads: Record<string, number> = {};
    for (let i = 0; i < 20; i++) loads[shiftDate("2026-08-20", i * 2)] = 50;
    const rows: GoogleMetricRow[] = [{ date: "2026-09-10", temp_night_c: 33.6, temp_baseline_c: 32.3 }];
    assert.equal(computeLoadContext(mkSeries("2026-09-15", 63, loads), rows, "2026-09-15").phase, "normal");
  });

  test("新用户(停训前没有任何负荷)→ 不进回归期", () => {
    assert.equal(computeLoadContext(mkSeries("2026-09-20", 63, {}), [], "2026-09-20").phase, "normal");
  });
});
