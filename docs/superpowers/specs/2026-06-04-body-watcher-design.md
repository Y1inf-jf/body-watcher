# Body Watcher - 训练计划 Agent 设计文档

## 概述

个人力量训练分析工具。用户手动录入健康指标和训练数据，Agent 自动分析恢复状态并生成下次训练计划。

**目标用户**：力量训练者，个人使用
**核心价值**：基于 HRV、心率等生理数据 + 训练历史，用 LLM Agent 生成科学的训练计划

## 技术栈

- **框架**：Next.js 15 (App Router) + TypeScript
- **样式**：TailwindCSS
- **图表**：Recharts
- **数据库**：better-sqlite3（单文件 SQLite）
- **LLM**：DeepSeek API（默认），通过 Vercel AI SDK 统一接口，可切换 GLM/Qwen
- **Agent 通信**：SSE 流式传输

## 数据模型

### daily_health - 每日健康指标

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增 |
| date | TEXT | 日期 YYYY-MM-DD |
| hrv | REAL | 心率变异性 (ms) |
| resting_hr | REAL | 静息心率 (bpm) |
| systolic | INTEGER | 收缩压 (mmHg) |
| diastolic | INTEGER | 舒张压 (mmHg) |
| sleep_hours | REAL | 睡眠时长 (h) |
| sleep_quality | INTEGER | 睡眠质量 (1-10) |
| weight | REAL | 体重 (kg) |
| body_fat | REAL | 体脂率 (%) |
| rpe | INTEGER | 主观疲劳感 (1-10) |
| notes | TEXT | 备注 |

**约束**：date 唯一

### training_log - 训练记录

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增 |
| date | TEXT | 日期 YYYY-MM-DD |
| duration | INTEGER | 训练时长 (min) |
| total_volume | REAL | 总训练容量 (kg) |
| rpe | INTEGER | 训练强度 RPE (1-10) |
| notes | TEXT | 备注 |

### training_exercise - 训练动作（训练记录的子表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增 |
| training_log_id | INTEGER FK | 关联训练记录 |
| exercise_name | TEXT | 动作名称 |
| muscle_group | TEXT | 目标肌群 |
| sets | INTEGER | 组数 |
| reps | INTEGER | 每组次数 |
| weight | REAL | 重量 (kg) |

### muscle_recovery - 肌群恢复状态（从训练记录自动推算）

不单独建表，通过查询 training_exercise + training_log 按肌群聚合计算：
- 各肌群最后一次训练日期
- 距今天数
- 近 7 天该肌群的累计训练容量

### training_plan - 训练计划（Agent 生成）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增 |
| date | TEXT | 生成日期 |
| plan_date | TEXT | 计划目标日期 |
| analysis_summary | TEXT | Agent 分析摘要 |
| recovery_assessment | TEXT | 恢复状态评估 |
| exercises | TEXT | 计划动作列表 (JSON) |
| advice | TEXT | 注意事项 |
| created_at | TEXT | 创建时间 |

## Agent 架构

### 工作流

```
用户触发"生成训练计划"
  → Agent 查询最近 7 天健康指标
  → Agent 查询各肌群恢复状态
  → Agent 读取近期训练历史（14 天）
  → Agent 综合推理，生成训练计划
  → 输出：训练内容 + 恢复评估 + 注意事项
```

### Agent 工具函数（Function Calling）

| 工具 | 参数 | 说明 |
|------|------|------|
| query_health_metrics | days: number | 查询最近 N 天健康指标 |
| query_training_history | days: number | 查询最近 N 天训练记录 |
| query_muscle_recovery | 无 | 查询各肌群恢复状态 |
| query_body_composition | days: number | 查询体重/体脂趋势 |
| save_training_plan | plan: object | 保存生成的训练计划 |

### Prompt 策略

- **角色**：力量训练教练 + 运动科学顾问
- **原则注入**：渐进超负荷、肌群恢复周期 48-72h、HRV 下降提示身体压力大、静息心率升高提示恢复不足
- **推理方式**：Agent 根据数据自主判断，不硬编码规则
- **输出格式**：结构化 JSON（动作列表 + 分析文本）

## 前端设计

### 页面结构

**Dashboard（/）**
- 健康趋势图：HRV、静息心率、睡眠折线图（最近 30 天）
- 恢复状态面板：各肌群红/黄/绿可视化
- 近期训练摘要：最近 5 次训练容量/强度趋势
- 体重/体脂趋势

**数据录入（/input）**
- 每日健康指标表单：一行排开，快速填写
- 训练记录表单：逐动作添加（名称、组数、次数、重量）
- 智能默认值：日期默认今天，数值类字段默认上次填的值

**训练计划（/plan）**
- "生成训练计划"按钮，触发 Agent
- 流式展示 Agent 分析过程
- 计划结果：动作列表、建议参数、恢复评估
- 历史计划存档

### UI 风格

深色主题，数据密集型，图表为主。

## 项目结构

```
body-watcher/
├── src/
│   ├── app/
│   │   ├── page.tsx              # Dashboard
│   │   ├── input/page.tsx        # 数据录入
│   │   ├── plan/page.tsx         # 训练计划
│   │   └── api/
│   │       ├── health/route.ts   # 健康指标 CRUD
│   │       ├── training/route.ts # 训练记录 CRUD
│   │       └── agent/route.ts    # Agent SSE 流式
│   ├── lib/
│   │   ├── db.ts                 # SQLite 初始化 + 查询
│   │   ├── agent.ts              # Agent 工具定义 + LLM 调用
│   │   └── llm.ts                # LLM 客户端封装
│   └── components/
│       ├── HealthForm.tsx
│       ├── TrainingForm.tsx
│       ├── RecoveryPanel.tsx
│       ├── TrendChart.tsx
│       └── PlanCard.tsx
├── data/                         # SQLite 数据库文件
├── package.json
└── .env                          # DEEPSEEK_API_KEY
```

## 设计决策

- **单用户**：无登录认证，本地运行
- **SQLite**：零部署依赖，数据完全本地
- **SSE 流式**：Agent 分析过程实时可见
- **Vercel AI SDK**：统一 LLM 接口，方便切换模型
- **API Key 安全**：仅存 .env，不暴露前端
