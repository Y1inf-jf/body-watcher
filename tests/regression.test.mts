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
import { computeReadiness } from "../src/lib/readiness";
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

  test("前晚差 → 债>90", () => {
    const debt = worstPrevNight().sleep.debtMinutes;
    assert.ok(debt !== null && debt > 90, `debt=${debt}`);
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
