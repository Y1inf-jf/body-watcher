# 恢复分修正 + 训练状态结合身体情况 设计

日期:2026-09-24 · 状态:待审阅

## 背景与目标

用户反馈两点:

1. **最近感觉挺好,恢复分一直偏低**(9/20–9/23 在 36–49)。
2. **训练状态总显示"欠训练"**,判断只看训练量,不看身体情况。

基于 2026-09-24 备份的诊断:

| 问题 | 证据 | 根因 |
|---|---|---|
| 前期误判红 | 9/10 静息心率 72 vs 基线 69.2±**0.98** → −2.88σ | 样本少 + 整数 RHR,标准差过小,无下限 |
| 病后基线钝化 | 病中数据入池后 HRV 标准差 5.7→10.0 | 均值/标准差对异常日不鲁棒 |
| 睡眠债系统性偏大 | 9/21–9/23 正常睡眠仍记 10–18 分钟债 | "近两晚取较差一晚"天然低于均值 |
| 正常日被判"降档" | 恢复分 45 左右 → readiness `low` → 主动降档 | `low` 门槛 = 50 = 个人均值,一半正常日落入 |
| 欠训练误导 | 9/12–9/20 停训 10 天后 ACWR 0.42–0.49 | ACWR 解读不看停训/生病背景 |
| 负荷被低估 | 9/23 训记 12 分钟 vs 手环 WORKOUT 52 分钟 | 训记计时不准(用户确认),负荷 = RPE×时长 |
| 打球未计入 | 9/19 SPORT+CARDIO 81 分钟、中高强度 69 分钟 | 负荷只来自训记 |

回放结论:9/20 之后分数偏低的主要拖累是**静息心率仍比病前高约 3 bpm**(真实信号,病后 RHR 恢复慢于 HRV);HRV 已回到基线。因此本次不上移分数刻度,保持"50 = 个人常态",修正解读门槛并在卡片上说明拖累项(用户选定方案 a)。

**非目标**:不对齐 Fitbit 自身就绪分(Google Health API 不提供);不重写为 Whoop 式每日负荷目标(方案 C,留作后续方向);不改 ACWR/Form/单调性公式本身。

## 成功标准

用 2026-09-24 备份回放 9/4–9/23:

- 9/16–9/18 恢复分仍为红(<34)。
- 9/20 之后今日建议为"正常练"(不再"主动降档")。
- 9/19 打球按折半心率负荷(约 91 AU)计入,当日 ACWR 约 1.40(偏高——带病打球,提醒合理)。
- 9/21、9/22 训练时长采用手环 WORKOUT 时长(32、52 分钟);这两天训练卡显示"回归期 · 第 1 周",今日建议仍为"正常练"并附"本周回归额度已用完"提示。
- 9/23 近 7 天负荷(9/17–9/23,约 189)≥ 病前周均(约 148)→ 退出回归期。
- 9/24 维持 normal,ACWR 约 1.17 落在最优区间。
- 全程不出现"欠训练"或"有加量空间"字样。
- `npm run check` 全绿;服务器上线后线上页面核对一次。

> 备注:回放显示原先的"欠训练"主要由训记时长偏短造成——仅做时长修正,9/24 ACWR 就从 0.49 回到 1.15。

> 更正(2026-10-08):本节最初给出的示例数字(9/19 约 84 AU/ACWR 约 1.34、9/24 近 7 天负荷约 182)是手算错误;终审按真实回放校正为上面的数字,并在第 3 部分补充了粘性退出规则与 ACWR 护栏规则。

## 第 1 部分:手环运动会话接入

### 数据表 `google_exercise_sessions`

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | Google dataPoint `name`,幂等 upsert |
| `date` | TEXT | 本地日期(复用 `exercisePointDate`) |
| `start_time` / `end_time` | TEXT | ISO UTC |
| `exercise_type` | TEXT | `WORKOUT` / `SPORT` / `WALKING` / `BIKING` / … |
| `recording_method` | TEXT | `ACTIVELY_MEASURED`(手动开运动模式)/ `PASSIVELY_MEASURED` |
| `active_minutes` | REAL | `activeDuration` |
| `zone_light_s` / `zone_moderate_s` / `zone_vigorous_s` / `zone_peak_s` | INTEGER | 缺失记 0 |
| `avg_hr` | INTEGER NULL | |

- `sync.ts` 解析 exercise 时同步 upsert 本表(`google_daily_metrics` 的聚合列保持不变)。
- `migrate()` 建表后,若表为空则从 `google_raw_data`(`data_type='exercise'`)回填。本地与服务器启动时各自完成。

### 纯函数模块 `src/lib/session-merge.ts`

**时长修正** `correctDurations(logs, sessions)`:

- 取当日 `exercise_type='WORKOUT' AND recording_method='ACTIVELY_MEASURED'` 的会话,`active_minutes` 求和记为 W。
- 当日恰好 1 条训练记录时:`duration = max(原 duration, W)`,并标记 `durationSource: "wearable"`。
- 当日多条记录时不修正(避免错配;历史上只有 6 月手动+训记重复,无手环数据)。

**额外活动** `extraActivities(sessions)`:

1. 排除 `WORKOUT`、`WALKING`、`BIKING`。
2. 其余会话按开始时间排序,前一段结束到后一段开始间隔 ≤10 分钟的合并为一组。
3. 组内 `moderate + vigorous + peak` ≥ 30 分钟 → 计为一次额外训练,负荷 = `hrLoadAu(组内四区秒数) × 0.5`。
   折半系数 `EXTRA_HR_LOAD_FACTOR = 0.5`:心率四区负荷对有氧/球类约为 sRPE/6 口径的 2 倍
   (9/19 心率负荷 167 AU,按 RPE7×80 分钟/6 ≈ 93 AU),折半后与力量训练同量纲(用户 2026-09-24 选定)。
4. 返回 `ExtraActivity[]`,即 `{ date, minutes, load, label }[]`(label 取组内最长会话类型的中文名,如"球类")。

对照现有数据:仅 9/19(CARDIO 07:24 + SPORT 07:44,中高强度 69 分钟)入选;9/5 RUNNING(14 分钟)、9/13 CARDIO(中强度 19 分钟)不入选,与用户描述一致。

### 接入训练状态

`computeTrainingStatus(logs, opts)` 新增 `opts.extraActivities?: ExtraActivity[]`,在 `buildDailyLoadSeries` 中按日累加(计入 `sessions`,不计入 `estimatedSessions`;`allSessionsEstimated` 只看训记训练)。`TrainingStatus` 新增:

- `durationCorrected: number` —— 时长被手环修正的训练次数
- `extraActivities: { date, minutes, load, label }[]` —— 窗口内计入的额外活动

`daily-context.ts` 负责查询会话、调用 `correctDurations` / `extraActivities` 后传入。

## 第 2 部分:恢复分修正(`recovery.ts`)

| 项 | 现在 | 改为 |
|---|---|---|
| 基线池 | 除今天外最近 21 个样本 | 除今天外最近 **30** 个样本 |
| 中心/离散 | 均值 / 样本标准差 | **中位数 / MAD×1.4826** |
| HRV 口径 | 原始 ms | **ln(ms)** 上计算 z;`baselineMean` 仍回显 ms(`exp(中位数)`) |
| 离散下限 | 无 | RHR ≥ **2.0 bpm**;ln HRV ≥ **0.08**;呼吸率 ≥ **0.5 次/分** |
| 睡眠债 | `ref − min(昨晚, 前晚)` | `ref − (⅔·昨晚 + ⅓·前晚)`;缺一晚时用另一晚 |
| HRV z 封顶 | 不封顶 | `clampZ` ±3,与其他项一致 |
| 就绪门槛 | 基线样本 ≥5 | 不变 |

- `computeBaseline` 改为鲁棒版本并接收离散下限参数;`BaselineFeature` 字段含义不变(`baselineMean` 语义变为"基线中心值",字段名保留以免破坏消费方)。
- 权重 40/30/30、正态 CDF 映射、±3 夹紧、旗标封顶 66 均不变。

### 主要拖累项

`RecoveryScore` 新增 `drag: { key: "hrv" | "restingHr" | "sleep"; text: string } | null`:取 `z × weightUsed` 最负且 z ≤ −0.5 的一项,生成如"静息心率比基线高 3 bpm""HRV 低于基线 12%""睡眠比参照线少 40 分钟"。无满足项为 null。`RecoveryScoreCard` 在分数下方展示该行。

### 今日建议门槛(`readiness.ts` `bandFromScore`)

| band | 现在 | 改为 |
|---|---|---|
| good | ≥67 | ≥67 |
| ok | 50–66 | **34–66 且无异常旗标** |
| low | 34–49 | **34–66 且有异常旗标**(血氧低/呼吸率高/体温高) |
| bad | <34 | <34 |

与恢复分颜色分区完全对齐:黄区卡片文案本就是"可正常训练",不再出现"卡片说正常、建议说降档"的矛盾。
审阅中由 40 门槛改为此方案:回放显示 9/20、9/22 新分为 38(RHR 仍偏高 + 睡眠一般,z≈−0.3),
40 门槛会让这两天继续"降档",与成功标准冲突;z≈−0.3 属于日常波动,不应单独触发降档。

## 第 3 部分:训练状态结合身体情况(`src/lib/load-context.ts`)

### 生病信号

纯函数 `illnessSignalDays(rowsAsc)`:某日满足任一即记为信号日——

- `temp_night_c − temp_baseline_c ≥ 1.0`
- `respiratory_rate ≥ 前 30 天中位数 + 1.0`(前序样本 ≥5 天才判)

### 回归期判定 `computeLoadContext(series, googleRowsAsc, today)`

**进入**,满足任一:

- **停训**:近 28 天内结束(或仍在持续)的、连续 ≥7 天日负荷为 0 的区间,且该区间之前 28 天内有训练负荷。
  (28 天窗口保证空窗结束后 21 天的回归期都能被识别。)
- **生病**:近 14 天内信号日 ≥2 天。

两者同时满足时 `reason = "illness"`。

**恢复日** `resumeDate`:max(空窗最后一天, 最后一个信号日)之后的第一个训练日。尚未恢复训练时仍处回归期,周序号为 0("尚未恢复训练"),上限按第 1 周给出。

**基准周负荷** `baseWeekly`:中断起点之前 28 天总负荷 ÷ 4。中断起点 = 空窗首日(有空窗时),否则为窗口内首个信号日。为 0 时不给上限,只提示"回归期"。

**回归周与上限**:`week = floor((today − resumeDate) / 7) + 1`;本回归周已练 = `resumeDate + 7(week−1)` 至今的负荷和;上限系数:第 1 周 0.6、第 2 周 0.8、第 3 周 1.0。

**退出**,满足任一:

- `today − resumeDate ≥ 21` 天;
- **粘性退出**(终审补充,2026-10-08):`resumeDate` 到 `today` 之间**曾经存在**任意一天 `d`,其以 `d` 为终点的近 7 天负荷 ≥ `baseWeekly`——一次命中就永久退出回归期,不会因为那部分负荷随时间滚出 7 天窗口而"退回"回归期。(原先只检查"今天"的近 7 天负荷,真实数据上会出现 9/19 打球达标、9/23 仍在窗口内、但 9/26 窗口已滚动导致误判回回归期的问题。)

### 输出 `LoadContext`

```ts
type LoadContext =
  | { phase: "return"; reason: "gap" | "illness"; resumeDate: string | null; week: number;
      weekLoad: number; weekCap: number | null; remaining: number | null; note: string }
  | { phase: "normal"; note: string | null };
```

挂在 `DailyContext.loadContext`,并随 `query_recovery_status` 返回给教练。

### 与今日建议合成(`readiness.ts`)

`classifyLoadBand(status, loadContext, recoveryBand)`:

- 回归期:新 `LoadBand = "ramp"`。`remaining ≤ 0`(本周额度用完)**只追加提示、不降档**(用户 2026-09-24 选定):
  说明文案追加"本周回归额度已用完,今天维持量,别再加"。
  **ACWR 护栏不因回归期关闭**(终审补充,2026-10-08):ACWR 处于 `risk` 区仍判 `deload`,否则 form 处于"疲劳积累"仍判 `hold`,都与非回归期结论一致;只有两者都不触发时才落到 `ramp`,其说明文案始终带上 ACWR 读数(如"……；ACWR 1.40 偏高"),不会因为在回归期就把偏高/峰值读数藏起来。
- 非回归期且 ACWR `under`:仅 `recoveryBand === "good"` 时为 `build`("有加量空间");`ok` 为 `maintain`,文案"负荷偏少,按计划练";`low`/`bad` 为 `maintain`,文案"低负荷合理,先恢复"。
- 其余逻辑(form 疲劳、单调性、无 RPE 不加量)不变。

`COMBOS` 新增 `ramp` 列:

| recovery | headline | detail 要点 |
|---|---|---|
| good | 正常练 | 回归期第 N 周,按上限循序加量,不冲极限 |
| ok | 正常练 | 同上 |
| low | 主动降档 | 回归期叠加恢复偏低,轻量为主 |
| bad | 今天休息 | 回归期恢复差,先休息观察 |

回归期内永不输出 `go_hard`。

### 文案

- `zone-meta.ts`:`under` 标签"欠训练"→"**负荷偏低**",描述"近期负荷低于慢性水平"。
- `readiness.ts` 负荷说明中 `under` 同步改为"负荷偏低"。
- `TrainingStatusCard`:回归期显示徽标"回归期 · 第 N 周"与进度"本周 X / 上限 Y AU";列出计入的额外活动("9/19 打球 81 分钟")和"N 次训练时长按手环修正"。
- `agent.ts` 系统提示:删除"<0.8 欠训练可加量",改为"<0.8 负荷偏低:是否加量取决于恢复分与 loadContext;回归期严格遵守 weekCap,不建议冲强度"。

## 第 4 部分:测试与发布

### 回归测试(`tests/regression.test.mts`,新增 suite)

- 鲁棒基线:含 4 个极端日的池子,中位数/MAD 基本不受影响;RHR 离散下限生效(全 70 的池子,今天 72 → RHR 分项 z = −1)。
- ln HRV z 与离散下限。
- 睡眠债加权:两晚都等于均值时债为 0。
- `drag` 选择最拖累项及文案。
- `bandFromScore` 新门槛(33→bad、34 无旗标→ok、50 有旗标→low、67→good)。
- `correctDurations`:单条取较大值;多条不改。
- `extraActivities`:9/19 夹具入选且负荷为心率负荷的一半、9/13 与 9/5 夹具不入选、WALKING/BIKING 排除、相邻合并。
- `illnessSignalDays` 与 `computeLoadContext`:停训触发、生病触发(单日不触发)、周序号与上限、两种退出条件。
- readiness:回归期不出 `go_hard`;回归期额度用完 + 恢复正常 → 仍为 `normal` 且说明含"额度已用完";`under` + 恢复一般不出"加量"。

### 回放脚本

`scripts/replay-recovery.ts`:只读打开指定备份库,逐日输出新旧恢复分、今日建议、LoadContext,用于验收成功标准(不入 CI)。

### 文档

更新 `docs/training-algorithms.md`:恢复分鲁棒基线/下限/ln HRV/睡眠债、新门槛、回归期、手环会话接入规则。

### 发布

按 AGENTS.md 标准流程:本地 `npm run check` → 提交推送 → 打包 scp → 服务器 `npm run build` 并重启(无新依赖,不需 `npm ci`)。迁移在服务启动时自动建表回填;上线后检查 `journalctl -u body-watcher` 无报错,并在线上总览页核对回归期与恢复分展示。

## 风险

- **心率负荷与 sRPE 量纲不完全等价**:0.5 折算系数来自单场比对,不同运动差异较大;只影响趋势,文档注明,后续可按实际数据再校准。
- **手环数据从 9/4 才开始**:病前 4 周的基准周负荷不含历史打球,若平时常打球,基准会偏低、回归期退出偏早(由 ACWR 偏高分区兜底)。
- **30 天基线在前期样本 <30 时即全部历史**:与现状一致,由离散下限兜底。
- **历史快照不重算**:`recovery_snapshots` 旧记录保留旧算法数值,月报会在切换日出现口径跳变;文档注明切换日期。
