# 恢复分修正 + 训练状态结合身体情况 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让恢复分在病后/样本少时不再系统性偏低,让训练状态结合手环真实时长、额外运动和身体情况(回归期)给出判断,不再误报"欠训练"。

**Architecture:** 算法层全部是纯函数(`recovery.ts` / `session-merge.ts` / `load-context.ts` / `training-status.ts` / `readiness.ts`),由 `daily-context.ts` 的新纯函数 `deriveDailyContext` 统一组装;数据层新增 `google_exercise_sessions` 表存手环逐段运动。UI(`RecoveryScoreCard` / `TrainingStatusCard`)与教练(`agent.ts`)只消费新增字段。

**Tech Stack:** Next.js 16.2.7(App Router)、React 19、TypeScript 5、better-sqlite3、node:test + tsx(测试)。

**Spec:** `docs/superpowers/specs/2026-09-24-recovery-load-context-design.md`

## Global Constraints

- 零新增依赖(dependencies / devDependencies 都不加)。
- 算法文件保持"纯函数、无副作用"风格,不 import `db.ts`;`src/lib/google/exercise-metrics.ts` 不 import 任何项目模块。
- 所有测试写在 `tests/regression.test.mts`,共享输入用工厂函数(每次调用重建),不用模块级共享变量。
- 代码注释、UI 文案用中文,与周边代码一致;UI 中不得再出现"欠训练"字样,改为"负荷偏低"。
- 恢复分:权重 40/30/30、正态 CDF 映射、±3 夹紧、旗标封顶 66 **不变**。
- 离散下限:RHR ≥ 2.0 bpm;ln HRV ≥ 0.08;呼吸率 ≥ 0.5 次/分。基线池 30 个样本,就绪门槛 ≥5 样本。
- 今日建议门槛:≥67 good;34–66 无旗标 ok;34–66 有旗标 low;<34 bad。
- 额外活动负荷 = `hrLoadAu(...) × 0.5`;合并间隔 ≤10 分钟;中高强度 ≥30 分钟才计入;排除 `WORKOUT` / `WALKING` / `BIKING`。
- 回归期:停训 = 近 28 天内连续 ≥7 天零负荷且之前 28 天有负荷;生病 = 近 14 天信号日 ≥2;上限系数 0.6 / 0.8 / 1.0;恢复训练满 21 天或近 7 天负荷 ≥ 基准周负荷即退出;超上限只提示不降档;回归期永不输出 `go_hard`。
- 两套环境:改完需发布到腾讯云服务器(见 Task 11),`.env` 无新增变量。
- Next.js 16 与训练数据不同:如需改路由/页面约定,先读 `node_modules/next/dist/docs/` 对应指南(本计划只给现有路由与组件加字段,不改约定)。

## Review Focus

- **被动识别的会话没有 `metricsSummary`**(如 WALKING/BIKING)→ 解析不能抛错,四区秒数记 0、`avgHr` 为 null。测试加在 Task 4。
- **`google_raw_data` 里有损坏的 JSON 快照**(服务器迁移回填时)→ 跳过该行继续回填,不能让应用启动失败。测试加在 Task 4(`sessionsFromRawPayloads`)。
- **今天没戴手环、HRV 缺失**→ 恢复分用其余项出分,"主要拖累项"不能选到 HRV。测试加在 Task 3。
- **调用方不传 `loadContext`**(老调用路径/测试)→ 今日建议行为与原来一致(除"欠训练"门控外)。测试加在 Task 8。
- **停训仍在持续、还没恢复训练**→ 回归期 `week = 0`、`resumeDate = null`,文案给出首周上限,不能出现 NaN 或负周数。测试加在 Task 7。

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/lib/recovery.ts` | 改 | 鲁棒基线(中位数/MAD/ln HRV/下限)、睡眠债加权、HRV z 夹紧、`drag` 主要拖累项 |
| `src/lib/google/exercise-metrics.ts` | 改 | 新增 `ExerciseSession` 类型、`parseExerciseSession`、`sessionsFromRawPayloads` |
| `src/lib/session-merge.ts` | 新建 | `correctDurations`(手环时长修正)、`extraActivities`(打球等额外活动) |
| `src/lib/db.ts` | 改 | `google_exercise_sessions` 建表、迁移回填、`upsertExerciseSessions`、`queryExerciseSessions` |
| `src/lib/google/sync.ts` | 改 | 同步时写入会话表 |
| `src/lib/training-status.ts` | 改 | `buildDailyLoadSeries` / `computeTrainingStatus` 接入额外活动,新增 `durationCorrected` / `extraActivities` 字段 |
| `src/lib/load-context.ts` | 新建 | `illnessSignalDays`、`computeLoadContext`(回归期)、`shiftDate` |
| `src/lib/readiness.ts` | 改 | 新门槛 `bandFromScore`、`ramp` 负荷档、`under` 按恢复门控、文案 |
| `src/lib/zone-meta.ts` | 改 | `under` 标签改"负荷偏低" |
| `src/lib/daily-context.ts` | 改 | 抽出纯函数 `deriveDailyContext`,接入会话/回归期 |
| `src/app/api/dashboard/route.ts` | 改 | 返回 `loadContext` |
| `src/app/page.tsx` | 改 | 把 `loadContext` 传给训练卡 |
| `src/components/RecoveryScoreCard.tsx` | 改 | 展示主要拖累项;睡眠债口径文案 |
| `src/components/TrainingStatusCard.tsx` | 改 | 回归期徽标与进度、额外活动、时长修正说明 |
| `src/lib/agent.ts` | 改 | 系统提示与工具返回加入 `loadContext` |
| `scripts/replay-recovery.ts` | 新建 | 用备份库逐日回放验收 |
| `docs/training-algorithms.md` | 改 | 算法文档同步 |
| `tests/regression.test.mts` | 改 | 所有新增用例 |

---

### Task 1: 鲁棒基线(中位数/MAD、ln HRV、离散下限、HRV 夹紧)

**Files:**
- Modify: `src/lib/recovery.ts`(`mean`/`sd` 辅助函数区、`computeBaseline`、`computeRecoveryFeatures` 的基线部分、`computeRecoveryScore` 的 `zHrv`)
- Test: `tests/regression.test.mts`

**Interfaces:**
- Consumes: 无
- Produces: `computeRecoveryFeatures` 签名不变;`BaselineFeature.baselineMean` 语义变为"基线中心值"(HRV 为 `exp(ln 中位数)`,单位 ms);`BaselineFeature.baselineSd` 为离散度(HRV 为 ln 单位)。新增导出 `median(values: number[]): number | null`(Task 7 复用)。

- [ ] **Step 1: 写失败测试**

在 `tests/regression.test.mts` 末尾追加(文件顶部 import 已有 `computeRecoveryFeatures, computeRecoveryScore`):

```ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx -y tsx --test --test-name-pattern="鲁棒基线" tests/regression.test.mts`
Expected: FAIL(如"RHR 离散下限"一条 zScore 为 null——全 70 时旧实现 `s > 0.001` 不成立)

- [ ] **Step 3: 实现**

在 `src/lib/recovery.ts` 中,把 `sd` 函数替换为下面的 `median` / `robustSpread`(`mean` 保留,睡眠均值仍在用):

```ts
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// MAD×1.4826:正态下与标准差同尺度,但少数极端日(如病中几天)拉不宽它。
function robustSpread(values: number[], center: number): number | null {
  if (values.length < 2) return null;
  return 1.4826 * (median(values.map((v) => Math.abs(v - center))) as number);
}
```

把 `computeBaseline` 整个替换为:

```ts
// 基线:中位数为中心、MAD 为离散,并设离散下限——样本少或设备给整数(RHR)时,
// 原始标准差可能不到 1 bpm,差 2 bpm 就被当成 −3σ 的"极端异常"。
// log=true 时在 ln 空间计算(HRV 近似对数正态,Plews 等的标准做法),回显仍换回原单位。
function computeBaseline(
  pool: number[],
  todayValue: number | null,
  opts: { minSpread: number; log?: boolean; minSamples?: number }
): BaselineFeature {
  const minSamples = opts.minSamples ?? 5;
  const valid = opts.log ? pool.filter((v) => v > 0) : pool;
  const t = opts.log ? valid.map(Math.log) : valid;
  const center = median(t);
  const rawSpread = center === null ? null : robustSpread(t, center);
  const spread = rawSpread === null ? null : Math.max(rawSpread, opts.minSpread);
  const ready = t.length >= minSamples && center !== null && spread !== null;
  const todayT =
    todayValue === null || (opts.log && todayValue <= 0) ? null : opts.log ? Math.log(todayValue) : todayValue;
  const zScore = ready && todayT !== null ? (todayT - (center as number)) / (spread as number) : null;
  const centerOut = center === null ? null : opts.log ? Math.exp(center) : center;
  const deviationPct =
    ready && todayValue !== null && centerOut ? ((todayValue - centerOut) / centerOut) * 100 : null;
  return {
    value: todayValue,
    baselineMean: round1(centerOut),
    baselineSd: spread === null ? null : opts.log ? Math.round(spread * 1000) / 1000 : round1(spread),
    zScore: zScore === null ? null : Math.round(zScore * 100) / 100,
    deviationPct: deviationPct === null ? null : Math.round(deviationPct * 10) / 10,
    baselineDays: t.length,
    ready,
  };
}
```

在 `computeRecoveryFeatures` 上方加常量:

```ts
const BASELINE_POOL = 30; // 基线池:除今天外最近 30 个样本
const SPREAD_FLOOR = { restingHr: 2.0, lnHrv: 0.08, respiratoryRate: 0.5 } as const;
```

在 `computeRecoveryFeatures` 内:
- `const pool = rowsAsc.slice(0, -1).slice(-21);` 改为 `const pool = rowsAsc.slice(0, -1).slice(-BASELINE_POOL);`,注释改为"基线池:除今天外、最近 30 天样本。"
- HRV:`...computeBaseline(hrvPool, today ? hrvOf(today) : null),` 改为 `...computeBaseline(hrvPool, today ? hrvOf(today) : null, { minSpread: SPREAD_FLOOR.lnHrv, log: true }),`
- RHR:`const rhrBase = computeBaseline(rhrPool, rhrValue);` 改为 `const rhrBase = computeBaseline(rhrPool, rhrValue, { minSpread: SPREAD_FLOOR.restingHr });`
- 呼吸率:`computeBaseline(rrPool, today?.respiratory_rate != null ? Number(today.respiratory_rate) : null)` 改为追加第三个参数 `{ minSpread: SPREAD_FLOOR.respiratoryRate }`。

在 `computeRecoveryScore` 内,`const zHrv = f.hrv.zScore;` 改为:

```ts
  const zHrv = f.hrv.zScore === null ? null : clampZ(f.hrv.zScore);
```

同时更新文件顶部 `// ---------- 恢复分` 段落注释中的"对 21 天基线取 z-score"为"对 30 天鲁棒基线(中位数/MAD,HRV 取对数)取 z-score"。

- [ ] **Step 4: 运行确认通过,且老用例不回归**

Run: `npm test`
Expected: 全部 PASS。若"真实数据回放"一组失败,打印 `computeRecoveryScore(...)` 的 components 检查:该组 RHR 从 57 跳到 68–70(中位数 57、离散下限 2),RHR 分项应夹到 −3,恢复分仍应落在 bad 档;不要为了过测而改断言,先定位差异原因。

- [ ] **Step 5: 提交**

```bash
git add src/lib/recovery.ts tests/regression.test.mts
git commit -m "feat(recovery): 基线改为中位数/MAD + ln HRV + 离散下限,HRV 分项夹紧"
```

---

### Task 2: 睡眠债加权(⅔ 昨晚 + ⅓ 前晚)

**Files:**
- Modify: `src/lib/recovery.ts`(`computeRecoveryFeatures` 中 `worstNightAsleep` 一段)
- Modify: `src/components/RecoveryScoreCard.tsx`(睡眠债口径文案)
- Test: `tests/regression.test.mts`(改一条老用例 + 新增两条)

**Interfaces:**
- Consumes: 无
- Produces: `SleepSummary.debtMinutes` 口径变为 `ref − (⅔·昨晚 + ⅓·前晚)`,字段名不变。

- [ ] **Step 1: 改写老用例并新增用例**

在 `describe("睡眠债口径", ...)` 中,把 `test("前晚差 → 债>90", ...)` 整条替换为:

```ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx -y tsx --test --test-name-pattern="睡眠债口径" tests/regression.test.mts`
Expected: FAIL("前晚差 → 按 ⅓ 计入"得到 debt≈103;"两晚都等于均值"得到正值)

- [ ] **Step 3: 实现**

在 `src/lib/recovery.ts` 中把:

```ts
  // 取近两晚较差一晚计债:连着两晚差睡眠不该被"昨晚碰巧还行"或均值本身被拉低所掩盖。
  const prevNightAsleep = rowsAsc.length >= 2 ? asleepOf(rowsAsc[rowsAsc.length - 2]) : null;
  const worstNightAsleep =
    lastNightAsleep === null
      ? prevNightAsleep
      : prevNightAsleep === null
        ? lastNightAsleep
        : Math.min(lastNightAsleep, prevNightAsleep);
```

替换为:

```ts
  // 近两晚加权(昨晚 ⅔、前晚 ⅓)计债:连着两晚差睡眠仍会反映出来;
  // 旧口径"取较差一晚"天然低于均值,正常睡眠也总记 10–20 分钟债,把分数系统性往下压。
  const prevNightAsleep = rowsAsc.length >= 2 ? asleepOf(rowsAsc[rowsAsc.length - 2]) : null;
  const blendedAsleep =
    lastNightAsleep === null
      ? prevNightAsleep
      : prevNightAsleep === null
        ? lastNightAsleep
        : (2 * lastNightAsleep + prevNightAsleep) / 3;
```

并把 `sleep.debtMinutes` 计算里的 `worstNightAsleep` 两处改为 `blendedAsleep`。同时把 `SleepSummary.debtMinutes` 字段注释改为"正值 = 欠觉;按近两晚加权(⅔ 昨晚 + ⅓ 前晚)vs 参照线计算"。

在 `src/components/RecoveryScoreCard.tsx` 中把 `"近两晚最差"` 改为 `"近两晚加权"`。

- [ ] **Step 4: 运行确认通过**

Run: `npm test`
Expected: 全部 PASS(三档睡眠目标一组:无 min 时债 ≈5,withMin(500) ≈53,仍满足"更大";冷启动 90 不变;ideal 封顶 490 不变)

- [ ] **Step 5: 提交**

```bash
git add src/lib/recovery.ts src/components/RecoveryScoreCard.tsx tests/regression.test.mts
git commit -m "fix(recovery): 睡眠债改为近两晚加权,去掉取最差一晚的系统性偏大"
```

---

### Task 3: 主要拖累项 + 今日建议新门槛

**Files:**
- Modify: `src/lib/recovery.ts`(`RecoveryScore` 类型、`computeRecoveryScore`)
- Modify: `src/lib/readiness.ts`(`bandFromScore`、`classifyRecoveryBand`)
- Modify: `src/components/RecoveryScoreCard.tsx`
- Test: `tests/regression.test.mts`

**Interfaces:**
- Consumes: Task 1 的 `BaselineFeature.deviationPct`、`restingHr.deviationBpm`
- Produces:
  - `export interface RecoveryDrag { key: "hrv" | "restingHr" | "sleep"; text: string }`(`recovery.ts`)
  - `RecoveryScore.drag: RecoveryDrag | null`
  - `export type RecoveryBand = "good" | "ok" | "low" | "bad"`(`readiness.ts`,原为非导出 type,Task 8 用)
  - `export function bandFromScore(score: number, hasFlags: boolean): RecoveryBand`

- [ ] **Step 1: 写失败测试**

在 `tests/regression.test.mts` 顶部 import 改为:

```ts
import { computeReadiness, bandFromScore } from "../src/lib/readiness";
```

在 `mkScore` 返回对象中 `note: null,` 之后加一行 `drag: null,`。

在文件末尾追加:

```ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx -y tsx --test --test-name-pattern="主要拖累项与新门槛" tests/regression.test.mts`
Expected: FAIL(`bandFromScore` 未导出 / `drag` 为 undefined)

- [ ] **Step 3: 实现 recovery.ts**

在 `RecoveryScore` 接口上方加:

```ts
// 主要拖累项:告诉用户分数是被哪一项拉低的(如"静息心率比基线高 3 bpm")。
export interface RecoveryDrag {
  key: "hrv" | "restingHr" | "sleep";
  text: string;
}
```

在 `RecoveryScore` 接口 `note` 之后加 `drag: RecoveryDrag | null; // 加权贡献最负且 z ≤ −0.5 的一项`。

在 `computeRecoveryScore` 上方加:

```ts
const DRAG_MIN_Z = -0.5; // 偏离不到半个 σ 属日常波动,不点名

function dragText(key: RecoveryDrag["key"], f: RecoveryFeatures): string {
  if (key === "hrv") {
    const pct = f.hrv.deviationPct;
    return pct !== null ? `HRV 低于基线 ${Math.abs(Math.round(pct))}%` : "HRV 低于基线";
  }
  if (key === "restingHr") {
    const d = f.restingHr.deviationBpm;
    return d !== null ? `静息心率比基线高 ${Math.round(d)} bpm` : "静息心率高于基线";
  }
  const debt = f.sleep.debtMinutes;
  return debt !== null ? `睡眠比参照线少 ${debt} 分钟` : "睡眠不足";
}
```

在 `const base: RecoveryScore = {` 中 `note: null,` 之后加 `drag: null,`。

在 `for (const c of available) { base.components[c.key].weightUsed = ... }` 循环之后加:

```ts
  let worst: { key: RecoveryDrag["key"]; contrib: number } | null = null;
  for (const c of available) {
    const contrib = (c.z * c.weight) / weightSum;
    if (c.z <= DRAG_MIN_Z && (worst === null || contrib < worst.contrib)) worst = { key: c.key, contrib };
  }
  base.drag = worst ? { key: worst.key, text: dragText(worst.key, f) } : null;
```

- [ ] **Step 4: 实现 readiness.ts**

把 `type RecoveryBand = "good" | "ok" | "low" | "bad";` 改为 `export type RecoveryBand = "good" | "ok" | "low" | "bad";`。

把 `bandFromScore` 整个替换为:

```ts
// 与恢复分颜色分区对齐:黄区(34–66)卡片文案就是"可正常训练",建议不能跟它唱反调。
// 50 是个人常态,旧门槛 50 会让一半正常日子被判"降档"。黄区只在有异常旗标时降为 low。
export function bandFromScore(score: number, hasFlags: boolean): RecoveryBand {
  if (score < 34) return "bad";
  if (score >= 67) return "good"; // 有旗标时分数封顶 66,到不了这里
  return hasFlags ? "low" : "ok";
}
```

把 `classifyRecoveryBand` 开头的出分分支替换为:

```ts
  if (recovery.score !== null && recovery.zone !== null) {
    const band = bandFromScore(recovery.score, recovery.flags.length > 0);
    const note =
      band === "bad"
        ? `恢复分 ${recovery.score} 偏低`
        : band === "low"
          ? `恢复分 ${recovery.score}，但有异常信号：${recovery.flags.join("、")}`
          : `恢复分 ${recovery.score} 状态不差`;
    return { band, note, usedFallback: false };
  }
```

- [ ] **Step 5: 实现 RecoveryScoreCard.tsx**

在 `<p className="mt-2 text-[10px] text-zinc-600">` (内容为 `50 = 你的正常水平 · {formula}`)之前插入:

```tsx
          {score.drag && (
            <p className="mt-2 text-[11px] text-zone-amber/90">主要拖累：{score.drag.text}</p>
          )}
```

并把该 `<p>` 的 `mt-2` 改为 `mt-1`。

- [ ] **Step 6: 运行确认通过**

Run: `npm test && npx tsc --noEmit`
Expected: 全部 PASS,tsc 无错误

- [ ] **Step 7: 提交**

```bash
git add src/lib/recovery.ts src/lib/readiness.ts src/components/RecoveryScoreCard.tsx tests/regression.test.mts
git commit -m "feat(recovery): 主要拖累项 + 今日建议门槛与颜色分区对齐"
```

---

### Task 4: 手环运动会话解析 + 时长修正 / 额外活动纯函数

**Files:**
- Modify: `src/lib/google/exercise-metrics.ts`
- Create: `src/lib/session-merge.ts`
- Test: `tests/regression.test.mts`

**Interfaces:**
- Consumes: `hrLoadAu(lightS, moderateS, vigorousS, peakS): number`(`training-status.ts`,已有);`TrainingLogRow`(`recovery.ts`)
- Produces:
  - `exercise-metrics.ts`:`export interface ExerciseSession { id: string; date: string; startTime: string; endTime: string; exerciseType: string; recordingMethod: string; activeMinutes: number; zoneLightS: number; zoneModerateS: number; zoneVigorousS: number; zonePeakS: number; avgHr: number | null }`;`export function parseExerciseSession(p: unknown): ExerciseSession | null`;`export function sessionsFromRawPayloads(payloads: string[]): ExerciseSession[]`
  - `session-merge.ts`:`export interface ExtraActivity { date: string; minutes: number; load: number; label: string }`;`export function correctDurations(logs: TrainingLogRow[], sessions: ExerciseSession[]): TrainingLogRow[]`(修正过的行带 `durationSource: "wearable"`);`export function extraActivities(sessions: ExerciseSession[]): ExtraActivity[]`;`export const EXTRA_HR_LOAD_FACTOR = 0.5`

- [ ] **Step 1: 写失败测试**

在 `tests/regression.test.mts` 顶部加 import:

```ts
import { parseExerciseSession, sessionsFromRawPayloads, type ExerciseSession } from "../src/lib/google/exercise-metrics";
import { correctDurations, extraActivities } from "../src/lib/session-merge";
```

在文件末尾追加:

```ts
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
    const ex = { ...(p.exercise as Record<string, unknown>), exerciseType: "WALKING" };
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
```

同时把文件顶部的 `import type { GoogleMetricRow, TrainingLogRow } from "../src/lib/recovery";` 保留(`TrainingLogRow` 已导入)。

- [ ] **Step 2: 运行确认失败**

Run: `npx -y tsx --test --test-name-pattern="手环运动会话" tests/regression.test.mts`
Expected: FAIL(模块 `session-merge` 不存在 / `parseExerciseSession` 未导出)

- [ ] **Step 3: 实现 exercise-metrics.ts**

在 `src/lib/google/exercise-metrics.ts` 的 `exercisePointDate` 之后追加:

```ts
// 单段运动会话(google_exercise_sessions 表的一行)。
// recordingMethod:ACTIVELY_MEASURED = 用户手动开了运动模式;PASSIVELY_MEASURED = 手环自动识别。
export interface ExerciseSession {
  id: string; // Google dataPoint name,幂等键
  date: string; // 本地日期
  startTime: string; // ISO UTC
  endTime: string;
  exerciseType: string; // WORKOUT / SPORT / WALKING / BIKING / ...
  recordingMethod: string;
  activeMinutes: number;
  zoneLightS: number;
  zoneModerateS: number;
  zoneVigorousS: number;
  zonePeakS: number;
  avgHr: number | null;
}

export function parseExerciseSession(p: unknown): ExerciseSession | null {
  const point = p as { name?: unknown; dataSource?: Record<string, unknown>; exercise?: Record<string, unknown> } | null;
  const ex = point?.exercise;
  const metrics = parseExercisePoint(p);
  const date = exercisePointDate(p);
  if (!ex || !metrics || !date || typeof point?.name !== "string") return null;
  const interval = (ex.interval ?? {}) as Record<string, unknown>;
  return {
    id: point.name,
    date,
    startTime: String(interval.startTime ?? ""),
    endTime: String(interval.endTime ?? ""),
    exerciseType: String(ex.exerciseType ?? "UNKNOWN"),
    recordingMethod: String(point.dataSource?.recordingMethod ?? "UNKNOWN"),
    activeMinutes: metrics.minutes,
    zoneLightS: metrics.zoneSeconds.light,
    zoneModerateS: metrics.zoneSeconds.moderate,
    zoneVigorousS: metrics.zoneSeconds.vigorous,
    zonePeakS: metrics.zoneSeconds.peak,
    avgHr: metrics.avgHr,
  };
}

// google_raw_data 里 exercise 快照(每行一个 JSON 数组)→ 会话列表。迁移回填与回放脚本共用;
// 单行损坏只跳过该行,不能让应用启动失败。
export function sessionsFromRawPayloads(payloads: string[]): ExerciseSession[] {
  const out: ExerciseSession[] = [];
  for (const raw of payloads) {
    let points: unknown;
    try {
      points = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!Array.isArray(points)) continue;
    for (const p of points) {
      const s = parseExerciseSession(p);
      if (s) out.push(s);
    }
  }
  return out;
}
```

- [ ] **Step 4: 实现 session-merge.ts**

Create `src/lib/session-merge.ts`:

```ts
// 手环运动会话 → 训练负荷的两处修正(纯函数,规则见 docs/training-algorithms.md 手环会话一节):
// 1. 训记计时常不准(用户确认),同日手动开启的 WORKOUT 时长更可信 → 修正训练时长;
// 2. 训记只记力量训练,打球等运动只在手环里 → 按心率负荷折算后计入。
import type { ExerciseSession } from "./google/exercise-metrics";
import type { TrainingLogRow } from "./recovery";
import { hrLoadAu } from "./training-status";

export interface ExtraActivity {
  date: string;
  minutes: number;
  load: number; // AU,已按 EXTRA_HR_LOAD_FACTOR 折算到 sRPE/6 量纲
  label: string;
}

// 心率四区负荷对有氧/球类约为 sRPE/6 口径的 2 倍(9/19:心率 167 AU vs RPE7×80分钟/6 ≈ 93),折半对齐。
export const EXTRA_HR_LOAD_FACTOR = 0.5;
const COMMUTE_TYPES = new Set(["WALKING", "BIKING"]); // 走路/通勤,不算训练
const MERGE_GAP_MS = 10 * 60 * 1000; // 间隔 ≤10 分钟视为同一场(如热身有氧接比赛)
const EXTRA_MIN_HARD_S = 30 * 60; // 中高强度累计 ≥30 分钟才计入

const TYPE_LABEL: Record<string, string> = {
  SPORT: "球类",
  CARDIO_WORKOUT: "有氧",
  RUNNING: "跑步",
  SWIMMING: "游泳",
  HIKING: "徒步",
};

function isLifting(s: ExerciseSession): boolean {
  return s.exerciseType === "WORKOUT" && s.recordingMethod === "ACTIVELY_MEASURED";
}

// 同日恰好一条训练记录时,时长取 max(训记, 手环 WORKOUT 合计);多条时无法可靠配对,不改。
export function correctDurations(logs: TrainingLogRow[], sessions: ExerciseSession[]): TrainingLogRow[] {
  const workoutMin = new Map<string, number>();
  for (const s of sessions) {
    if (isLifting(s)) workoutMin.set(s.date, (workoutMin.get(s.date) ?? 0) + s.activeMinutes);
  }
  const logsPerDate = new Map<string, number>();
  for (const l of logs) logsPerDate.set(l.date, (logsPerDate.get(l.date) ?? 0) + 1);

  return logs.map((l) => {
    const w = workoutMin.get(l.date);
    if (w === undefined || logsPerDate.get(l.date) !== 1) return l;
    const rounded = Math.round(w);
    if (rounded <= Number(l.duration ?? 0)) return l;
    return { ...l, duration: rounded, durationSource: "wearable" };
  });
}

export function extraActivities(sessions: ExerciseSession[]): ExtraActivity[] {
  const candidates = sessions
    .filter((s) => s.exerciseType !== "WORKOUT" && !COMMUTE_TYPES.has(s.exerciseType))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const groups: ExerciseSession[][] = [];
  for (const s of candidates) {
    const group = groups[groups.length - 1];
    const prev = group?.[group.length - 1];
    if (prev && new Date(s.startTime).getTime() - new Date(prev.endTime).getTime() <= MERGE_GAP_MS) {
      group.push(s);
    } else {
      groups.push([s]);
    }
  }

  const out: ExtraActivity[] = [];
  for (const g of groups) {
    const sum = (k: "zoneLightS" | "zoneModerateS" | "zoneVigorousS" | "zonePeakS" | "activeMinutes") =>
      g.reduce((acc, s) => acc + s[k], 0);
    const hard = sum("zoneModerateS") + sum("zoneVigorousS") + sum("zonePeakS");
    if (hard < EXTRA_MIN_HARD_S) continue;
    const longest = g.reduce((a, b) => (b.activeMinutes > a.activeMinutes ? b : a));
    const load = hrLoadAu(sum("zoneLightS"), sum("zoneModerateS"), sum("zoneVigorousS"), sum("zonePeakS"));
    out.push({
      date: g[0].date,
      minutes: Math.round(sum("activeMinutes")),
      load: Math.round(load * EXTRA_HR_LOAD_FACTOR * 10) / 10,
      label: TYPE_LABEL[longest.exerciseType] ?? "运动",
    });
  }
  return out;
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npm test && npx tsc --noEmit`
Expected: 全部 PASS

- [ ] **Step 6: 提交**

```bash
git add src/lib/google/exercise-metrics.ts src/lib/session-merge.ts tests/regression.test.mts
git commit -m "feat(sessions): 解析手环逐段运动,训练时长按手环修正,打球等按折半心率负荷计入"
```

---

### Task 5: 会话表、迁移回填、同步写入

**Files:**
- Modify: `src/lib/db.ts`(`createTables`、`migrate` 末尾、Google 区新增两个函数)
- Modify: `src/lib/google/sync.ts`(exercise 拉取段、落库事务)

**Interfaces:**
- Consumes: Task 4 的 `ExerciseSession`、`parseExerciseSession`、`sessionsFromRawPayloads`
- Produces:`export function upsertExerciseSessions(sessions: ExerciseSession[]): void`;`export function queryExerciseSessions(days: number): ExerciseSession[]`(按 `start_time` 升序)

- [ ] **Step 1: 建表**

在 `src/lib/db.ts` 顶部加 import:

```ts
import { sessionsFromRawPayloads, type ExerciseSession } from "./google/exercise-metrics";
```

在 `createTables` 的 SQL 中 `google_raw_data` 表定义之后加:

```sql
    CREATE TABLE IF NOT EXISTS google_exercise_sessions (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      exercise_type TEXT,
      recording_method TEXT,
      active_minutes REAL,
      zone_light_s INTEGER DEFAULT 0,
      zone_moderate_s INTEGER DEFAULT 0,
      zone_vigorous_s INTEGER DEFAULT 0,
      zone_peak_s INTEGER DEFAULT 0,
      avg_hr INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_exercise_sessions_date ON google_exercise_sessions(date);
```

- [ ] **Step 2: 写入/查询函数**

在 `saveGoogleRawData` 之后加:

```ts
// 手环逐段运动。按 dataPoint name 幂等 upsert;内部函数收 db 参数,供 migrate 回填时使用(避免递归 getDb)。
function writeExerciseSessions(db: Database.Database, sessions: ExerciseSession[]) {
  const stmt = db.prepare(`
    INSERT INTO google_exercise_sessions
      (id, date, start_time, end_time, exercise_type, recording_method, active_minutes,
       zone_light_s, zone_moderate_s, zone_vigorous_s, zone_peak_s, avg_hr)
    VALUES (@id, @date, @startTime, @endTime, @exerciseType, @recordingMethod, @activeMinutes,
       @zoneLightS, @zoneModerateS, @zoneVigorousS, @zonePeakS, @avgHr)
    ON CONFLICT(id) DO UPDATE SET
      date = excluded.date, start_time = excluded.start_time, end_time = excluded.end_time,
      exercise_type = excluded.exercise_type, recording_method = excluded.recording_method,
      active_minutes = excluded.active_minutes, zone_light_s = excluded.zone_light_s,
      zone_moderate_s = excluded.zone_moderate_s, zone_vigorous_s = excluded.zone_vigorous_s,
      zone_peak_s = excluded.zone_peak_s, avg_hr = excluded.avg_hr
  `);
  db.transaction(() => {
    for (const s of sessions) stmt.run(s);
  })();
}

export function upsertExerciseSessions(sessions: ExerciseSession[]) {
  if (sessions.length > 0) writeExerciseSessions(getDb(), sessions);
}

export function queryExerciseSessions(days: number): ExerciseSession[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM google_exercise_sessions
    WHERE date >= date('now', 'localtime', '-' || ? || ' days')
    ORDER BY start_time ASC
  `).all(days) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    date: String(r.date),
    startTime: String(r.start_time ?? ""),
    endTime: String(r.end_time ?? ""),
    exerciseType: String(r.exercise_type ?? "UNKNOWN"),
    recordingMethod: String(r.recording_method ?? "UNKNOWN"),
    activeMinutes: Number(r.active_minutes ?? 0),
    zoneLightS: Number(r.zone_light_s ?? 0),
    zoneModerateS: Number(r.zone_moderate_s ?? 0),
    zoneVigorousS: Number(r.zone_vigorous_s ?? 0),
    zonePeakS: Number(r.zone_peak_s ?? 0),
    avgHr: r.avg_hr == null ? null : Number(r.avg_hr),
  }));
}
```

- [ ] **Step 3: 迁移回填**

在 `migrate` 函数末尾(`CREATE INDEX IF NOT EXISTS idx_chat_messages_session` 之后)加:

```ts
  // 手环逐段运动:新表为空时从原始快照回填(本地与服务器各自在启动时完成,幂等)。
  const sessionCount = db.prepare("SELECT COUNT(*) AS n FROM google_exercise_sessions").get() as { n: number };
  if (sessionCount.n === 0) {
    const raws = db
      .prepare("SELECT payload FROM google_raw_data WHERE data_type = 'exercise'")
      .all() as { payload: string }[];
    const sessions = sessionsFromRawPayloads(raws.map((r) => r.payload));
    if (sessions.length > 0) writeExerciseSessions(db, sessions);
  }
```

- [ ] **Step 4: 同步写入**

在 `src/lib/google/sync.ts`:
- import 区从 `./exercise-metrics` 的导入中加 `parseExerciseSession, type ExerciseSession`;从 `@/lib/db`(或现有 db 导入处,与 `saveGoogleRawData` 同一 import 语句)加 `upsertExerciseSessions`。
- 在 `const rawByDate = new Map<string, unknown[]>();` 之后加 `const sessions: ExerciseSession[] = [];`
- 在运动段 `parseExerciseIntoMetrics(metrics, rawByDate, points);` 之后加:

```ts
      for (const p of points) {
        const s = parseExerciseSession(p);
        if (s) sessions.push(s);
      }
```

- 在落库事务 `for (const [date, partial] of metrics) upsertGoogleDailyMetrics({ date, ...partial });` 之后加 `upsertExerciseSessions(sessions);`(better-sqlite3 支持事务嵌套,内部走 savepoint)。

- [ ] **Step 5: 用备份副本验证迁移回填**

`db.ts` 用 `process.cwd()/data/body-watcher.db` 定位数据库,所以在临时目录里放一份备份副本再加载模块(`SCRATCH` 换成会话草稿目录):

```bash
SCRATCH="C:/Users/82460/AppData/Local/Temp/claude/bw-mig"
mkdir -p "$SCRATCH/data" && cp /d/SelfInfo/bw-backups/body-watcher-20260924.db "$SCRATCH/data/body-watcher.db"
cd "$SCRATCH" && npx -y tsx -e "import('file:///D:/test_projects/body-watcher/src/lib/db.ts').then((m) => { const rows = m.getDb().prepare('SELECT date, exercise_type, recording_method, active_minutes FROM google_exercise_sessions ORDER BY start_time').all(); console.log(rows.length); console.table(rows); })"
```

Expected: 输出 13 行,含 9/19 的 BIKING / CARDIO_WORKOUT / SPORT 与 9/21、9/23 的 WORKOUT ACTIVELY_MEASURED。验证完删除 `$SCRATCH`。

- [ ] **Step 6: 类型检查与测试**

Run: `npx tsc --noEmit && npm test`
Expected: 无错误,全部 PASS

- [ ] **Step 7: 提交**

```bash
git add src/lib/db.ts src/lib/google/sync.ts
git commit -m "feat(db): 新增 google_exercise_sessions 表,同步写入并从原始快照回填"
```

---

### Task 6: 训练状态接入额外活动与时长修正统计

**Files:**
- Modify: `src/lib/training-status.ts`(`DailyLoadPoint` 不变;`buildDailyLoadSeries`、`TrainingStatus`、`computeTrainingStatus`)
- Test: `tests/regression.test.mts`

**Interfaces:**
- Consumes: Task 4 的 `ExtraActivity`;`correctDurations` 产出的 `durationSource: "wearable"` 标记
- Produces:
  - `buildDailyLoadSeries(logs: TrainingLogRow[], days: number, today?: string, extras?: ExtraActivity[]): DailyLoadPoint[]`
  - `computeTrainingStatus(logs, opts: { days?: number; today?: string; extraActivities?: ExtraActivity[] })`
  - `TrainingStatus.durationCorrected: number`;`TrainingStatus.extraActivities: ExtraActivity[]`

- [ ] **Step 1: 写失败测试**

在 `tests/regression.test.mts` 顶部 import 加 `type ExtraActivity`:

```ts
import { correctDurations, extraActivities, type ExtraActivity } from "../src/lib/session-merge";
```

在文件末尾追加:

```ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx -y tsx --test --test-name-pattern="训练状态接入手环会话" tests/regression.test.mts`
Expected: FAIL(`extraActivities` 字段不存在,9/19 负荷为 0)

- [ ] **Step 3: 实现**

在 `src/lib/training-status.ts` 顶部加:

```ts
import type { ExtraActivity } from "./session-merge";
```

(`session-merge.ts` 运行时导入 `training-status.ts` 的 `hrLoadAu`,这里只做 type 导入,不形成运行时循环。)

`buildDailyLoadSeries` 签名改为:

```ts
export function buildDailyLoadSeries(
  logs: TrainingLogRow[],
  days: number,
  today: string = localToday(),
  extras: ExtraActivity[] = []
): DailyLoadPoint[] {
```

在 `for (const log of logs) { ... }` 聚合循环之后、`const series: DailyLoadPoint[] = [];` 之前加:

```ts
  // 手环额外活动(打球等):负荷已折算到同一量纲;不算"估计 RPE"。
  for (const a of extras) {
    if (a.load <= 0) continue;
    const day = byDate.get(a.date);
    if (day) {
      day.load += a.load;
      day.sessions += 1;
    } else {
      byDate.set(a.date, { load: a.load, rpe: null, estimated: false, sessions: 1, estimatedSessions: 0 });
    }
  }
```

`TrainingStatus` 接口在 `allSessionsEstimated` 之后加:

```ts
  durationCorrected: number; // 窗口内训练时长被手环 WORKOUT 修正的次数
  extraActivities: ExtraActivity[]; // 窗口内计入的手环额外活动(打球等)
```

`computeTrainingStatus` 整个替换为:

```ts
// 默认 35 天窗口:28 天慢性池 + 7 天缓冲(EWMA 初值衰减)。
export function computeTrainingStatus(
  logs: TrainingLogRow[],
  opts: { days?: number; today?: string; extraActivities?: ExtraActivity[] } = {}
): TrainingStatus {
  const days = opts.days ?? 35;
  const full = buildDailyLoadSeries(logs, days, opts.today, opts.extraActivities ?? []);
  const windowStart = full[0]?.date ?? "";
  const windowEnd = full[full.length - 1]?.date ?? "";
  const inWindow = (d: string) => d >= windowStart && d <= windowEnd;
  const extras = (opts.extraActivities ?? []).filter((a) => a.load > 0 && inWindow(a.date));
  const estimatedSessions = full.reduce((acc, p) => acc + p.estimatedSessions, 0);
  const totalSessions = full.reduce((acc, p) => acc + p.sessions, 0);
  // 无 RPE 模式只看训记训练:额外活动的负荷来自心率,不该把"全部估算"判定翻掉。
  const liftingSessions = totalSessions - extras.length;
  return {
    series: full.slice(-28),
    yesterdayLoad: full.length >= 2 ? full[full.length - 2].load : 0,
    acwr: computeAcwr(full),
    form: computeForm(full),
    weekly: computeWeeklyLoad(full),
    estimatedSessions,
    totalSessions,
    allSessionsEstimated: liftingSessions > 0 && estimatedSessions === liftingSessions,
    durationCorrected: logs.filter((l) => l.durationSource === "wearable" && inWindow(String(l.date))).length,
    extraActivities: extras,
  };
}
```

在测试文件的 `mkStatus` 返回对象中 `allSessionsEstimated: false,` 之后加 `durationCorrected: 0, extraActivities: [],`。

- [ ] **Step 4: 运行确认通过**

Run: `npm test && npx tsc --noEmit`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/training-status.ts tests/regression.test.mts
git commit -m "feat(training): 负荷序列计入手环额外活动,统计时长修正次数"
```

---

### Task 7: 回归期判定 `load-context.ts`

**Files:**
- Create: `src/lib/load-context.ts`
- Test: `tests/regression.test.mts`

**Interfaces:**
- Consumes: `DailyLoadPoint`(`training-status.ts`)、`GoogleMetricRow` 与 `median`(`recovery.ts`,Task 1)
- Produces:
  - `export type LoadContext = { phase: "return"; reason: "gap" | "illness"; resumeDate: string | null; week: number; weekLoad: number; weekCap: number | null; remaining: number | null; note: string } | { phase: "normal"; note: null }`
  - `export function illnessSignalDays(rowsAsc: GoogleMetricRow[]): string[]`
  - `export function computeLoadContext(series: DailyLoadPoint[], googleRowsAsc: GoogleMetricRow[], today: string): LoadContext`
  - `export function shiftDate(date: string, days: number): string`

- [ ] **Step 1: 写失败测试**

在 `tests/regression.test.mts` 顶部加 import:

```ts
import { computeLoadContext, illnessSignalDays, shiftDate } from "../src/lib/load-context";
import type { DailyLoadPoint } from "../src/lib/training-status";
```

在文件末尾追加:

```ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx -y tsx --test --test-name-pattern="生病信号|回归期" tests/regression.test.mts`
Expected: FAIL(模块 `load-context` 不存在)

- [ ] **Step 3: 实现**

Create `src/lib/load-context.ts`:

```ts
// 训练状态的"身体情况"解读层:停训或生病之后,ACWR 的"负荷偏低"是应该的——
// 这时该防的是补量过猛,所以进入回归期,按病前周均给逐周上限(0.6 → 0.8 → 1.0)。
// 纯函数、无副作用;规则见 docs/training-algorithms.md 回归期一节。
import { median, type GoogleMetricRow } from "./recovery";
import type { DailyLoadPoint } from "./training-status";

export type LoadContext =
  | {
      phase: "return";
      reason: "gap" | "illness";
      resumeDate: string | null; // 恢复训练首日;null = 尚未恢复
      week: number; // 回归第几周;0 = 尚未恢复
      weekLoad: number; // 本回归周已练(AU)
      weekCap: number | null; // 本周上限;病前无负荷时为 null
      remaining: number | null;
      note: string;
    }
  | { phase: "normal"; note: null };

const GAP_MIN_DAYS = 7;
const GAP_SEARCH_DAYS = 28; // 空窗结束后 21 天回归期都要能识别到
const ILLNESS_WINDOW_DAYS = 14;
const ILLNESS_MIN_DAYS = 2; // 单日体温/呼吸率异常可能是噪声
const BASE_WINDOW_DAYS = 28;
const RETURN_MAX_DAYS = 21;
const RAMP_FACTORS = [0.6, 0.8, 1.0] as const;
const TEMP_RISE_C = 1.0;
const RR_RISE = 1.0;
const RR_MIN_PRIOR = 5;

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000);
}

// 生病信号日:皮肤温度比设备基线高 ≥1°C(与 recovery 旗标同口径,保留 1 位小数比较),
// 或呼吸率比前 30 天中位数高 ≥1 次/分(前序样本 ≥5 天才判)。
export function illnessSignalDays(rowsAsc: GoogleMetricRow[]): string[] {
  const out: string[] = [];
  rowsAsc.forEach((r, i) => {
    const tempDev =
      r.temp_night_c != null && r.temp_baseline_c != null
        ? Math.round((Number(r.temp_night_c) - Number(r.temp_baseline_c)) * 10) / 10
        : null;
    let rrHigh = false;
    if (r.respiratory_rate != null) {
      const prior = rowsAsc
        .slice(Math.max(0, i - 30), i)
        .map((x) => x.respiratory_rate)
        .filter((v): v is number => v != null)
        .map(Number);
      const m = prior.length >= RR_MIN_PRIOR ? median(prior) : null;
      rrHigh = m !== null && Number(r.respiratory_rate) >= m + RR_RISE;
    }
    if ((tempDev !== null && tempDev >= TEMP_RISE_C) || rrHigh) out.push(r.date);
  });
  return out;
}

// 最近一段连续 ≥7 天零负荷(可仍在持续),要求结束日在近 28 天内、且此前 28 天有训练。
function findRecentGap(series: DailyLoadPoint[], today: string): { start: string; end: string } | null {
  let runEnd = -1;
  for (let i = series.length - 1; i >= 0; i--) {
    const zero = series[i].load === 0;
    if (zero && runEnd === -1) runEnd = i;
    if (runEnd === -1 || (zero && i > 0)) continue;
    const runStart = zero ? i : i + 1;
    if (runEnd - runStart + 1 >= GAP_MIN_DAYS) {
      const end = series[runEnd].date;
      if (daysBetween(end, today) > GAP_SEARCH_DAYS) return null;
      const before = series.slice(Math.max(0, runStart - BASE_WINDOW_DAYS), runStart);
      return before.some((p) => p.load > 0) ? { start: series[runStart].date, end } : null;
    }
    runEnd = -1;
  }
  return null;
}

export function computeLoadContext(
  series: DailyLoadPoint[],
  googleRowsAsc: GoogleMetricRow[],
  today: string
): LoadContext {
  const gap = findRecentGap(series, today);
  const signals = illnessSignalDays(googleRowsAsc).filter(
    (d) => d <= today && daysBetween(d, today) < ILLNESS_WINDOW_DAYS
  );
  const ill = signals.length >= ILLNESS_MIN_DAYS;
  if (!gap && !ill) return { phase: "normal", note: null };

  const reason: "gap" | "illness" = ill ? "illness" : "gap";
  const breakStart = gap ? gap.start : signals[0];
  const ends = [gap?.end, ill ? signals[signals.length - 1] : undefined].filter((d): d is string => !!d);
  const breakEnd = ends.sort()[ends.length - 1];
  const sumLoad = (points: DailyLoadPoint[]) => points.reduce((acc, p) => acc + p.load, 0);

  const baseIdx = series.findIndex((p) => p.date === breakStart);
  const baseWeekly = baseIdx > 0 ? sumLoad(series.slice(Math.max(0, baseIdx - BASE_WINDOW_DAYS), baseIdx)) / 4 : 0;
  const resumeDate = series.find((p) => p.date > breakEnd && p.load > 0)?.date ?? null;

  if (resumeDate !== null) {
    const load7d = sumLoad(series.slice(-7));
    if (daysBetween(resumeDate, today) >= RETURN_MAX_DAYS || (baseWeekly > 0 && load7d >= baseWeekly)) {
      return { phase: "normal", note: null };
    }
  }

  const week = resumeDate === null ? 0 : Math.floor(daysBetween(resumeDate, today) / 7) + 1;
  const factor = RAMP_FACTORS[Math.min(Math.max(week, 1), RAMP_FACTORS.length) - 1];
  const weekCap = baseWeekly > 0 ? Math.round(baseWeekly * factor) : null;
  const weekStart = resumeDate === null ? null : shiftDate(resumeDate, 7 * (week - 1));
  const weekLoad =
    weekStart === null ? 0 : Math.round(sumLoad(series.filter((p) => p.date >= weekStart && p.date <= today)));
  const remaining = weekCap === null ? null : weekCap - weekLoad;
  const label = reason === "illness" ? "病后" : "停训后";

  let note: string;
  if (week === 0) {
    note = `回归期（${label}）：尚未恢复训练${weekCap !== null ? `，首周负荷上限 ${weekCap} AU` : ""}`;
  } else {
    note = `回归期第 ${week} 周（${label}）：本周 ${weekLoad}${weekCap !== null ? ` / 上限 ${weekCap}` : ""} AU`;
    note += remaining !== null && remaining <= 0 ? "，本周回归额度已用完，今天维持量，别再加" : "，循序加量";
  }
  return { phase: "return", reason, resumeDate, week, weekLoad, weekCap, remaining, note };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test && npx tsc --noEmit`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/load-context.ts tests/regression.test.mts
git commit -m "feat(training): 回归期判定——停训/生病后按病前周均逐周给负荷上限"
```

---

### Task 8: 今日建议合成回归期,"欠训练"按恢复门控并改名

**Files:**
- Modify: `src/lib/readiness.ts`(`LoadBand`、`classifyLoadBand`、`COMBOS`、`computeReadiness`)
- Modify: `src/lib/zone-meta.ts`(`ACWR_ZONE_META.under`)
- Test: `tests/regression.test.mts`

**Interfaces:**
- Consumes: Task 3 的 `RecoveryBand`;Task 7 的 `LoadContext`
- Produces:
  - `classifyLoadBand(status: TrainingStatus, opts?: { loadContext?: LoadContext | null; recoveryBand?: RecoveryBand }): LoadBandResult`
  - `computeReadiness(status, recovery, opts: { manualSleepQuality?: number | null; loadContext?: LoadContext | null })`

- [ ] **Step 1: 写失败测试**

在 `tests/regression.test.mts` 顶部加 import:

```ts
import type { LoadContext } from "../src/lib/load-context";
```

在文件末尾追加:

```ts
describe("今日建议结合回归期", () => {
  const returnCtx = (remaining: number): LoadContext => ({
    phase: "return", reason: "illness", resumeDate: "2026-09-19", week: 1, weekLoad: 121, weekCap: 121 + remaining, remaining,
    note: remaining <= 0 ? "回归期第 1 周（病后）：本周 121 / 上限 75 AU，本周回归额度已用完，今天维持量，别再加" : "回归期第 1 周（病后）：本周 40 / 上限 75 AU，循序加量",
  });

  test("回归期 + 恢复正常 + 额度用完 → 仍正常练,负荷说明含额度提示", () => {
    const r = computeReadiness(mkStatus("under", 0), mkScore(45), { loadContext: returnCtx(-46) });
    assert.equal(r.level, "normal");
    assert.match(r.loadPart ?? "", /额度已用完/);
  });

  test("回归期 + 恢复好 → 不出可以冲", () => {
    assert.equal(computeReadiness(mkStatus("under", 0), mkScore(85), { loadContext: returnCtx(30) }).level, "normal");
  });

  test("回归期 + 恢复差 → 休息", () => {
    assert.equal(computeReadiness(mkStatus("under", 0), mkScore(20), { loadContext: returnCtx(30) }).level, "rest");
  });

  test("非回归期负荷偏低 + 恢复一般 → 不提加量", () => {
    const r = computeReadiness(mkStatus("under", 0), mkScore(55));
    assert.equal(r.level, "normal");
    assert.doesNotMatch(`${r.detail}${r.loadPart}`, /加量空间|补量/);
    assert.match(r.loadPart ?? "", /负荷偏少，按计划练/);
  });

  test("非回归期负荷偏低 + 恢复好 → 仍可冲(不传 loadContext 的老调用)", () => {
    assert.equal(computeReadiness(mkStatus("under", 0), mkScore(80)).level, "go_hard");
  });

  test("文案不再出现欠训练", () => {
    const r = computeReadiness(mkStatus("under", 0), mkScore(55));
    assert.doesNotMatch(`${r.loadPart}`, /欠训练/);
    assert.equal(ACWR_ZONE_META.under.label, "负荷偏低");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx -y tsx --test --test-name-pattern="今日建议结合回归期" tests/regression.test.mts`
Expected: FAIL("回归期 + 恢复好"得到 go_hard;标签仍为"欠训练")

- [ ] **Step 3: 实现 readiness.ts**

顶部 import 加:

```ts
import type { LoadContext } from "./load-context";
```

`type LoadBand = "build" | "maintain" | "hold" | "deload";` 改为:

```ts
// ramp = 回归期(停训/生病后):按逐周上限循序加量,永不"可以冲"。
type LoadBand = "build" | "maintain" | "hold" | "deload" | "ramp";
```

`classifyLoadBand` 整个替换为:

```ts
export function classifyLoadBand(
  status: TrainingStatus,
  opts: { loadContext?: LoadContext | null; recoveryBand?: RecoveryBand } = {}
): LoadBandResult {
  // 回归期优先:此时 ACWR 偏低是应该的,解读交给回归期上限。超上限只提示(note 里已带),不降档。
  if (opts.loadContext?.phase === "return") {
    return { band: "ramp", note: opts.loadContext.note };
  }

  const { acwr, form, weekly } = status;
  const parts: string[] = [];
  let band: LoadBand = "maintain";
  let underNote: string | null = null;

  if (acwr.zone === null) {
    parts.push("负荷数据累计中");
  } else {
    parts.push(`ACWR ${acwr.value?.toFixed(2)} ${acwr.zone === "under" ? "负荷偏低" : acwr.zone === "optimal" ? "最优" : acwr.zone === "high" ? "偏高" : "急性峰值"}`);
    if (acwr.zone === "risk") band = "deload";
    else if (acwr.zone === "high") band = "hold";
    else if (acwr.zone === "under") {
      // 负荷偏低只在恢复好时才等于"可加量";恢复一般/偏低时低负荷本身是合理的。
      // 老调用方不传 recoveryBand 时保持原行为。
      const rb = opts.recoveryBand;
      if (rb === undefined || rb === "good") band = "build";
      else underNote = rb === "ok" ? "负荷偏少，按计划练" : "低负荷合理，先恢复";
    }
  }
  if (form.zone === "fatigued") {
    parts.push(`form ${form.value}（疲劳积累）`);
    if (band === "build" || band === "maintain") band = "hold";
  } else if (form.zone !== null && (form.zone === "neutral" || form.zone === "fresh")) {
    parts.push(`form ${form.value}（${FORM_LABEL[form.zone]}）`);
  }
  if (weekly.monotonyWarning && weekly.monotony !== null) {
    parts.push(`单调性 ${weekly.monotony.toFixed(1)}（内容太单一）`);
    if (band === "build") band = "maintain";
  }
  // 训记没有 RPE 时,组数和时长只能反映剂量,不能可靠判断接近力竭程度。
  // 保留高负荷预警的保守价值,但不让估算出的"负荷偏低"驱动加量/冲强度。
  if (status.allSessionsEstimated && band === "build") {
    parts.push("负荷由组数和时长估算，不据此加量");
    band = "maintain";
  }

  const noteMap: Record<LoadBand, string> = {
    build: "相对平时偏少，有加量空间",
    maintain: underNote ?? "负荷节奏健康",
    hold: "不再加量",
    deload: "负荷突变，有受伤风险",
    ramp: "",
  };
  return { band, note: `${parts.join("，")}——${noteMap[band]}` };
}
```

在 `COMBOS` 的四个 recovery 档中各加 `ramp` 键:

```ts
    ramp: { level: "normal", headline: "正常练", detail: "回归期：按本周上限循序加量，不冲极限" },
```
(加到 `good` 和 `ok`)

```ts
    ramp: { level: "downgrade", headline: "主动降档", detail: "回归期叠加恢复偏低：轻量为主，别急着找回原来的量" },
```
(加到 `low`)

```ts
    ramp: { level: "rest", headline: "今天休息", detail: "回归期恢复差：先休息观察，持续两天以上留意是否复发" },
```
(加到 `bad`)

`computeReadiness` 的签名与末段改为:

```ts
export function computeReadiness(
  status: TrainingStatus,
  recovery: RecoveryScore,
  opts: { manualSleepQuality?: number | null; loadContext?: LoadContext | null } = {}
): Readiness {
```

并把

```ts
  const rec = classifyRecoveryBand(recovery, manualQ);
  const load = classifyLoadBand(status);
```

改为

```ts
  const rec = classifyRecoveryBand(recovery, manualQ);
  const load = classifyLoadBand(status, { loadContext: opts.loadContext ?? null, recoveryBand: rec.band });
```

- [ ] **Step 4: 实现 zone-meta.ts**

把 `ACWR_ZONE_META.under` 的

```ts
    label: "欠训练",
    desc: "慢性负荷高于近期,有加量空间",
```

改为

```ts
    label: "负荷偏低",
    desc: "近期负荷低于慢性水平",
```

- [ ] **Step 5: 运行确认通过(含老 readiness 黄金用例)**

Run: `npm test && npx tsc --noEmit`
Expected: 全部 PASS。老用例中"恢复bad×负荷build → 降档"现在走 `maintain`(bad × maintain = downgrade),结论不变。

- [ ] **Step 6: 提交**

```bash
git add src/lib/readiness.ts src/lib/zone-meta.ts tests/regression.test.mts
git commit -m "feat(readiness): 今日建议合成回归期;负荷偏低按恢复门控,欠训练改名负荷偏低"
```

---

### Task 9: 组装接线 + 仪表盘卡片 + 教练

**Files:**
- Modify: `src/lib/daily-context.ts`
- Modify: `src/app/api/dashboard/route.ts:85-97`
- Modify: `src/app/page.tsx`(`DashboardData` 接口、`TrainingStatusCard` 调用处 149 行)
- Modify: `src/components/TrainingStatusCard.tsx`
- Modify: `src/lib/agent.ts`(系统提示第 99 行、`query_recovery_status` 描述第 198 行与返回第 204–210 行)
- Test: `tests/regression.test.mts`

**Interfaces:**
- Consumes: Task 4 `correctDurations` / `extraActivities` / `ExerciseSession`;Task 5 `queryExerciseSessions`;Task 6 `computeTrainingStatus(..., { today, extraActivities })` / `buildDailyLoadSeries(..., extras)`;Task 7 `computeLoadContext`;Task 8 `computeReadiness(..., { loadContext })`
- Produces:
  - `export interface DailyInputs { today: string; googleRows: GoogleMetricRow[]; healthMetrics: Record<string, unknown>[]; logs: TrainingLogRow[]; sessions: ExerciseSession[]; sleepTargets: SleepTargets; hr?: "none" | "summary" | "full" }`
  - `export function deriveDailyContext(inp: DailyInputs): DailyContext`(纯函数,Task 10 回放脚本复用)
  - `DailyContext.loadContext: LoadContext`
  - 仪表盘 API 响应新增 `loadContext`

- [ ] **Step 1: 写失败测试(组装层端到端)**

在 `tests/regression.test.mts` 顶部加 import:

```ts
import { deriveDailyContext } from "../src/lib/daily-context";
```

在文件末尾追加:

```ts
describe("每日上下文组装(端到端)", () => {
  // 复用回归期夹具:病前每 3 天 50 AU(用 duration=50/rpe=6 → 50 AU),9/21 训记只记 12 分钟但手环 WORKOUT 32 分钟
  const inputs = () => {
    const logs: TrainingLogRow[] = [];
    for (let i = 0; i < 10; i++) logs.push({ date: shiftDate("2026-08-15", i * 3), duration: 50, rpe: 6 });
    logs.push({ date: "2026-09-21", duration: 12, exercises: [{ sets: 20 }] });
    logs.reverse(); // 与 queryTrainingHistoryDetailed 一致:DESC
    return {
      today: "2026-09-21",
      googleRows: sickRows(),
      healthMetrics: [],
      logs,
      sessions: [
        ...ballDay(),
        mkSession({ date: "2026-09-21", exerciseType: "WORKOUT", recordingMethod: "ACTIVELY_MEASURED", startTime: "2026-09-21T04:13:00Z", endTime: "2026-09-21T04:45:00Z", activeMinutes: 31.8 }),
      ],
      sleepTargets: { minMinutes: null, targetMinutes: null, idealMinutes: null },
    };
  };

  test("时长修正 + 打球计入 + 回归期全部接通", () => {
    const ctx = deriveDailyContext(inputs());
    assert.equal(ctx.trainingStatus.durationCorrected, 1);
    assert.equal(ctx.trainingStatus.extraActivities.length, 1);
    assert.equal(ctx.loadContext.phase, "return");
    assert.match(ctx.readiness.loadPart ?? "", /回归期第 1 周/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx -y tsx --test --test-name-pattern="每日上下文组装" tests/regression.test.mts`
Expected: FAIL(`deriveDailyContext` 未导出)

- [ ] **Step 3: 实现 daily-context.ts**

import 区改为(在原有基础上增补):

```ts
import {
  getSleepTargets,
  queryExerciseSessions,
  queryGoogleDailyMetricsRange,
  queryHealthMetrics,
  queryTrainingHistoryDetailed,
  upsertDailyAdvice,
  upsertRecoverySnapshot,
  type AdviceRow,
} from "./db";
import {
  computeRecoveryFeatures,
  computeRecoveryScore,
  localToday,
  type GoogleMetricRow,
  type RecoveryFeatures,
  type RecoveryScore,
  type SleepTargets,
  type TrainingLogRow,
} from "./recovery";
import {
  buildDailyLoadSeries,
  computeHrLoadStatus,
  computeSleepNeed,
  computeTrainingStatus,
  hrDailyFromRows,
  hrLoadsByDateFromRows,
  type SleepNeedResult,
  type TrainingStatus,
} from "./training-status";
import { computeReadiness, type Readiness } from "./readiness";
import { latestManualSleepQuality, mergeManualHealth } from "./health-merge";
import { computeLoadContext, type LoadContext } from "./load-context";
import { correctDurations, extraActivities } from "./session-merge";
import type { ExerciseSession } from "./google/exercise-metrics";
```

`DailyContext` 接口在 `readiness: Readiness;` 之后加:

```ts
  /** 回归期判定(停训/生病后的逐周负荷上限) */
  loadContext: LoadContext;
```

在 `loadDailyContext` 之前加常量与纯函数:

```ts
// 回归期要看"中断前 28 天 + 中断 + 回归 21 天",训练与会话多取到 63 天。
const LOAD_HISTORY_DAYS = 63;

export interface DailyInputs {
  today: string;
  googleRows: GoogleMetricRow[]; // 升序
  healthMetrics: Record<string, unknown>[];
  logs: TrainingLogRow[]; // DESC(与 queryTrainingHistoryDetailed 一致)
  sessions: ExerciseSession[];
  sleepTargets: SleepTargets;
  hr?: "none" | "summary" | "full";
}

/** 纯函数:给定原始输入算出当天全部派生结果。loadDailyContext 与回放脚本共用。 */
export function deriveDailyContext(inp: DailyInputs): DailyContext {
  const hr = inp.hr ?? "none";
  const merged = mergeManualHealth(inp.googleRows, inp.healthMetrics);
  const recoveryFeatures = computeRecoveryFeatures(merged, { sleepTargets: inp.sleepTargets });
  const recoveryScore = computeRecoveryScore(recoveryFeatures);

  // 训记计时不准时以手环 WORKOUT 时长为准;打球等只在手环里的运动折算后计入。
  const logs = correctDurations(inp.logs, inp.sessions);
  const extras = extraActivities(inp.sessions);
  const trainingStatus = computeTrainingStatus(logs, { today: inp.today, extraActivities: extras });
  if (hr !== "none") {
    trainingStatus.hr = computeHrLoadStatus(hrLoadsByDateFromRows(inp.googleRows), inp.today);
    if (hr === "full") trainingStatus.hr.daily = hrDailyFromRows(inp.googleRows);
  }
  const loadContext = computeLoadContext(
    buildDailyLoadSeries(logs, LOAD_HISTORY_DAYS, inp.today, extras),
    inp.googleRows,
    inp.today
  );

  const sleepNeed = computeSleepNeed(recoveryFeatures.sleep, trainingStatus.yesterdayLoad, inp.sleepTargets);
  const readiness = computeReadiness(trainingStatus, recoveryScore, {
    manualSleepQuality: latestManualSleepQuality(inp.healthMetrics),
    loadContext,
  });

  return {
    today: inp.today,
    googleRows: inp.googleRows,
    healthMetrics: inp.healthMetrics,
    recoveryFeatures,
    recoveryScore,
    trainingStatus,
    sleepNeed,
    readiness,
    loadContext,
    // logs 是 DESC:首条即最近一次训练。
    lastSessionDate: logs.length > 0 ? String(logs[0].date) : null,
    trainingLogs: logs,
  };
}
```

`loadDailyContext` 函数体整个替换为:

```ts
  const days = opts.days ?? 35;
  return deriveDailyContext({
    today: localToday(),
    googleRows: queryGoogleDailyMetricsRange(days) as GoogleMetricRow[],
    healthMetrics: queryHealthMetrics(30) as Record<string, unknown>[],
    logs: queryTrainingHistoryDetailed(Math.max(days, LOAD_HISTORY_DAYS)) as TrainingLogRow[],
    sessions: queryExerciseSessions(Math.max(days, LOAD_HISTORY_DAYS)),
    sleepTargets: getSleepTargets(),
    hr: opts.hr,
  });
```

并更新 `loadDailyContext` 上方 JSDoc 的 `days` 说明:"训练记录与手环会话至少取 63 天(回归期判定需要),更早的记录不影响 35 天训练状态窗口。"

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test && npx tsc --noEmit`
Expected: 全部 PASS

- [ ] **Step 5: 仪表盘 API 与页面**

`src/app/api/dashboard/route.ts`:在从 context 解构的变量里加 `loadContext`(与 `readiness` 同处),并在 `NextResponse.json({...})` 中 `readiness,` 之后加 `loadContext,`。

`src/app/page.tsx`:
- import 加 `import type { LoadContext } from "@/lib/load-context";`
- `DashboardData` 接口加 `loadContext?: LoadContext;`
- 第 149 行改为:

```tsx
          {data.trainingStatus && <TrainingStatusCard status={data.trainingStatus} loadContext={data.loadContext ?? null} />}
```

- [ ] **Step 6: TrainingStatusCard**

`src/components/TrainingStatusCard.tsx`:
- import 加 `import type { LoadContext } from "@/lib/load-context";`
- 组件签名改为 `export default function TrainingStatusCard({ status, loadContext = null }: { status: TrainingStatus; loadContext?: LoadContext | null }) {`
- 在组件体内 `const today = ...` 之后加:

```tsx
  const ret = loadContext?.phase === "return" ? loadContext : null;
```

- `CardTitle` 的 `right` 改为同时容纳回归期徽标:

```tsx
        right={
          <div className="flex items-center gap-2">
            {ret && (
              <span className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent">
                回归期 · {ret.week === 0 ? "未恢复训练" : `第 ${ret.week} 周`}
              </span>
            )}
            {status.weekly.monotonyWarning && (
              <span className="rounded border border-zone-amber/40 bg-zone-amber/10 px-1.5 py-0.5 font-mono text-[10px] text-zone-amber">
                ⚠ 单调性 {status.weekly.monotony}
              </span>
            )}
          </div>
        }
```

- 把无 RPE 提示文案中的 `估算出的“欠训练”不会触发加量建议。` 改为 `估算出的“负荷偏低”不会触发加量建议。`
- 在 `{status.hr && <HrLoadLine hr={status.hr} />}` 之前插入:

```tsx
          {ret && (
            <div className="mt-2">
              <p className="text-[10px] text-accent/90">{ret.note}</p>
              {ret.weekCap !== null && ret.week > 0 && (
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-white/8">
                  <div
                    className={`h-full ${ret.weekLoad > ret.weekCap ? "bg-zone-amber" : "bg-accent"}`}
                    style={{ width: `${Math.min((ret.weekLoad / ret.weekCap) * 100, 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}
          {status.extraActivities.length > 0 && (
            <p className="mt-2 text-[10px] text-zinc-500">
              含手环运动：
              {status.extraActivities.map((a) => `${a.date.slice(5)} ${a.label} ${a.minutes} 分钟（+${Math.round(a.load)} AU）`).join("；")}
            </p>
          )}
          {status.durationCorrected > 0 && (
            <p className="mt-1 text-[10px] text-zinc-500">{status.durationCorrected} 次训练时长按手环运动记录修正</p>
          )}
```

- 文件底部 `HrLoadLine` 上方注释中"RPE 侧"欠训练""改为"RPE 侧"负荷偏低""。

- [ ] **Step 7: 教练(agent.ts)**

在第 99 行系统提示中做三处替换:
- `（<0.8 欠训练可加量；` → `（<0.8 负荷偏低——是否加量取决于恢复分与 loadContext，不能单凭它建议加量；`
- `绝不能因“欠训练”建议加量或冲强度` → `绝不能因“负荷偏低”建议加量或冲强度`
- `不要凭任一侧单独下“欠训练”结论` → `不要凭任一侧单独下“负荷偏低”结论`

并在该条末尾追加:

```
。query_recovery_status 返回 loadContext：phase=return 表示病后/停训后的回归期——按 weekCap 循序加量、不安排冲强度或测极限；remaining≤0 时今天只维持量、不再加；trainingStatus.extraActivities 是手环记录的打球等额外运动（已计入负荷），durationCorrected 表示有几次训练时长按手环修正
```

`query_recovery_status` 工具描述字符串中 `readiness（与总览页同源的今日建议合成结论）` 之后追加 `、loadContext（回归期判定与本周负荷上限）`;工具返回对象中 `readiness: ctx.readiness,` 之后加 `loadContext: ctx.loadContext,`。

- [ ] **Step 8: 检查与浏览器核对**

Run: `npx tsc --noEmit && npx eslint src/lib src/components src/app && npm test`
Expected: 全部通过

然后 `npm run dev`,在内置浏览器打开 `http://localhost:3000` 登录后核对:恢复分卡出现"主要拖累"行(若当日无拖累项则不显示);训练卡无"欠训练"字样。本地库数据较旧(9/12),回归期不一定出现,线上核对放在 Task 11。

- [ ] **Step 9: 提交**

```bash
git add src/lib/daily-context.ts src/app/api/dashboard/route.ts src/app/page.tsx src/components/TrainingStatusCard.tsx src/lib/agent.ts tests/regression.test.mts
git commit -m "feat: 每日上下文接入手环会话与回归期,训练卡与教练同步展示"
```

---

### Task 10: 回放验收脚本 + 算法文档

**Files:**
- Create: `scripts/replay-recovery.ts`
- Modify: `docs/training-algorithms.md`
- Modify: `README.md`(功能特性"恢复与训练状态算法"一节,一句话)

**Interfaces:**
- Consumes: Task 9 `deriveDailyContext`;Task 4 `sessionsFromRawPayloads`
- Produces: 无(验收工具)

- [ ] **Step 1: 回放脚本**

Create `scripts/replay-recovery.ts`:

```ts
/**
 * 恢复分 / 训练状态回放(只读,不入 CI)。
 *
 * 用备份库逐日重算"当天打开总览页会看到什么",对照 recovery_snapshots 里旧算法落档的分数,
 * 用于验收 docs/superpowers/specs/2026-09-24-recovery-load-context-design.md 的成功标准。
 * 手环会话直接从 google_raw_data 解析——老备份里还没有 google_exercise_sessions 表也能跑。
 *
 * 用法:npx -y tsx scripts/replay-recovery.ts <备份库路径> [起始日期] [结束日期]
 *   例:npx -y tsx scripts/replay-recovery.ts D:/SelfInfo/bw-backups/body-watcher-20260924.db 2026-09-04 2026-09-24
 */
import Database from "better-sqlite3";
import { deriveDailyContext } from "../src/lib/daily-context";
import { sessionsFromRawPayloads } from "../src/lib/google/exercise-metrics";
import { shiftDate } from "../src/lib/load-context";
import type { GoogleMetricRow, SleepTargets, TrainingLogRow } from "../src/lib/recovery";

const [dbPath, from = "2026-09-04", to = "2026-09-24"] = process.argv.slice(2);
if (!dbPath) {
  console.error("用法: npx -y tsx scripts/replay-recovery.ts <备份库路径> [起始日期] [结束日期]");
  process.exit(1);
}
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const setting = (key: string): number | null => {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
};
const sleepTargets: SleepTargets = {
  minMinutes: setting("sleep_min_minutes"),
  targetMinutes: setting("sleep_target_minutes"),
  idealMinutes: setting("sleep_ideal_minutes"),
};
const allSessions = sessionsFromRawPayloads(
  (db.prepare("SELECT payload FROM google_raw_data WHERE data_type = 'exercise'").all() as { payload: string }[]).map((r) => r.payload)
);
const snapshot = db.prepare("SELECT score FROM recovery_snapshots WHERE date = ?");

console.log("日期        旧分  新分  拖累项                      今日建议   ACWR  回归期");
for (let day = from; day <= to; day = shiftDate(day, 1)) {
  const googleRows = db
    .prepare("SELECT * FROM google_daily_metrics WHERE date > ? AND date <= ? ORDER BY date ASC")
    .all(shiftDate(day, -35), day) as GoogleMetricRow[];
  const healthMetrics = db
    .prepare("SELECT * FROM daily_health WHERE date > ? AND date <= ? ORDER BY date DESC")
    .all(shiftDate(day, -30), day) as Record<string, unknown>[];
  const logs = db
    .prepare("SELECT * FROM training_log WHERE date > ? AND date <= ? ORDER BY date DESC")
    .all(shiftDate(day, -63), day) as TrainingLogRow[];
  for (const log of logs) {
    log.exercises = db.prepare("SELECT * FROM training_exercise WHERE training_log_id = ?").all(log.id) as TrainingLogRow["exercises"];
  }
  const sessions = allSessions.filter((s) => s.date > shiftDate(day, -63) && s.date <= day);

  const ctx = deriveDailyContext({ today: day, googleRows, healthMetrics, logs, sessions, sleepTargets });
  const old = (snapshot.get(day) as { score: number | null } | undefined)?.score ?? null;
  const lc = ctx.loadContext;
  console.log(
    [
      day,
      String(old ?? "—").padStart(4),
      String(ctx.recoveryScore.score ?? "—").padStart(4),
      (ctx.recoveryScore.drag?.text ?? "").padEnd(24),
      ctx.readiness.headline.padEnd(6),
      String(ctx.trainingStatus.acwr.value ?? "—").padStart(5),
      lc.phase === "return" ? lc.note : "",
    ].join("  ")
  );
}
```

- [ ] **Step 2: 运行回放,逐条核对成功标准**

Run: `npx -y tsx scripts/replay-recovery.ts D:/SelfInfo/bw-backups/body-watcher-20260924.db 2026-09-04 2026-09-24`

Expected(逐条对照 spec「成功标准」):
- 9/16–9/18 新分 < 34。
- 9/20 起"今日建议"列为"正常练"。
- 9/19 ACWR 约 1.3(偏高),9/24 约 1.1–1.2。
- 9/21、9/23 回归期列含"回归期第 1 周"与"额度已用完";9/24 回归期列为空。
- 全部输出无"欠训练"字样(`| grep 欠训练` 无结果)。

若有不符,先定位是哪一层(恢复分 / 负荷序列 / 回归期 / 合成)与 spec 规则不一致再改;若是 spec 本身的数字估计偏差(如 ACWR 1.17 vs 1.21),在最终汇报中如实说明,不改规则凑数。

- [ ] **Step 3: 更新算法文档**

在 `docs/training-algorithms.md` 中:
- 恢复分一节:把"21 天基线 / 均值 ± 标准差"改为"30 天鲁棒基线:中位数 ± MAD×1.4826;HRV 在 ln 空间计算;离散下限 RHR 2 bpm、ln HRV 0.08、呼吸率 0.5 次/分",睡眠债改为"近两晚加权(⅔ 昨晚 + ⅓ 前晚)",新增"主要拖累项"说明;注明切换日 2026-09-24,此前 `recovery_snapshots` 为旧口径。
- 今日建议(第 8 节):门槛表改为 good ≥67 / ok 34–66 无旗标 / low 34–66 有旗标 / bad <34;负荷侧新增 `ramp`(回归期)与"负荷偏低按恢复门控"。
- 新增"手环会话"小节:时长修正规则、额外活动规则(排除类型、10 分钟合并、≥30 分钟中高强度、×0.5 折算及依据)。
- 新增"回归期"小节:进入/退出条件、基准周负荷、0.6/0.8/1.0 逐周上限、超上限只提示不降档。
- 全文"欠训练"改为"负荷偏低"。

`README.md` 的"📈 恢复与训练状态算法"列表加一条:`- **回归期**：停训或生病后按病前周均逐周给负荷上限（60% → 80% → 100%），训练时长以手环运动记录校正，打球等运动按心率负荷折算计入`,并把"对 21 天个人基线取 z-score"改为"对 30 天个人鲁棒基线（中位数/MAD）取 z-score"。

- [ ] **Step 4: 全量检查**

Run: `npm run check`
Expected: tsc、lint、test 全部通过

- [ ] **Step 5: 提交**

```bash
git add scripts/replay-recovery.ts docs/training-algorithms.md README.md
git commit -m "docs: 回放验收脚本与算法文档同步(鲁棒基线/回归期/手环会话)"
```

---

### Task 11: 发布到腾讯云并线上核对

**Files:** 无代码改动

- [ ] **Step 1: 推送**

```bash
git push origin master
```

- [ ] **Step 2: 打包上传(按 AGENTS.md,排除目录一个都不能少)**

```bash
tar czf /tmp/bw.tar.gz --exclude=node_modules --exclude=.next --exclude=.git --exclude=.zcode --exclude=data --exclude=.env .
scp -i ~/.ssh/tencent_cloud /tmp/bw.tar.gz ubuntu@1.14.67.6:/tmp/
```

- [ ] **Step 3: 服务器构建重启(无新依赖,不跑 npm ci)**

```bash
ssh -i ~/.ssh/tencent_cloud ubuntu@1.14.67.6 'cd ~/body-watcher && tar xzf /tmp/bw.tar.gz && npm run build && sudo systemctl restart body-watcher'
```

- [ ] **Step 4: 核对迁移与日志**

```bash
ssh -i ~/.ssh/tencent_cloud ubuntu@1.14.67.6 'journalctl -u body-watcher -n 50 --no-pager; sqlite3 ~/body-watcher/data/body-watcher.db "SELECT COUNT(*) FROM google_exercise_sessions;"'
```

Expected: 日志无报错;会话表行数 ≥13(首个请求触发 `getDb()` 后才迁移——如为 0,先访问一次站点再查)。

- [ ] **Step 5: 线上页面核对**

在内置浏览器打开 `http://1.14.67.6`(由用户登录),核对:恢复分卡"主要拖累"行、训练卡无"欠训练"、ACWR 与 9/24 回放一致、回归期徽标按当天实际状态显示(9/24 起应已退出)。把核对结果如实汇报给用户。
