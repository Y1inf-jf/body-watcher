# Body Watcher

[English](./README.en.md) | 简体中文

> 个人力量训练追踪与分析工具 —— 记录训练与健康数据，用 AI 生成下一次训练计划。

基于 Next.js 16（App Router）+ React 19 + TypeScript + better-sqlite3 构建，前端使用 Tailwind CSS，图表使用 Recharts。训练计划生成由带函数调用（Function Calling）能力的 LLM Agent 驱动。

## 功能特性

### 📊 数据看板
- **趋势图表**：HRV、静息心率、睡眠时长、体重/体脂随时间变化的折线图
- **恢复面板**：各肌群上次训练距今的天数及 7 天累计训练容量，辅助判断恢复状态
- **训练日历**：按月展示每日训练情况与涉及肌群
- **渐进超负荷追踪**：选定动作查看最大重量与 1RM 估算趋势，支持 **Epley / Brzycki / Lombardi 三种公式切换**
- **周总结**：AI 自动总结本周训练概况、亮点与改进建议

### 📝 数据录入
- **每日健康指标**：HRV、静息心率、血压、睡眠（时长+质量）、体重、体脂、RPE、备注
- **训练记录**：多动作多组录入，支持次数 / 重量 / 自重 / RPE，可存为模板复用
- **wger 动作库搜索**：录入动作时自动联想，优先显示历史动作，不足时从内置的 wger 动作库（852 条已审核动作）补全

### 🤖 AI 训练计划
- 一键生成下一次训练计划，Agent 会自动查询你的健康指标、肌群恢复状态、训练历史
- 综合渐进超负荷、肌群恢复（48-72h）、HRV/心率/睡眠信号给出分析
- 流式输出分析过程，支持中途取消
- 计划自动入库，可在「训练计划」页查看历史

## 技术栈

| 领域 | 技术 |
|------|------|
| 框架 | Next.js 16.2.7（App Router, Turbopack） |
| 前端 | React 19, TypeScript 5, Tailwind CSS 4 |
| 图表 | Recharts 3 |
| 数据库 | better-sqlite3（本地 SQLite，WAL 模式） |
| AI | 任意 OpenAI 兼容 API（默认 DeepSeek），SSE 流式输出 |
| 动作数据 | [wger](https://wger.de) 开源动作数据库 |

## ⚠️ 部署约束（重要）

本项目设计为**单用户本地工具**，未实现任何鉴权：

- 所有 API 路由、数据库均**无用户隔离与身份校验**
- `DEEPSEEK_API_KEY` 等密钥仅存在本地 `.env`（已 gitignore）
- **请勿直接暴露到公网或局域网**。如需远程访问，请自行在前面加反向代理 + 鉴权层

仅监听 `localhost` 运行：`npm run dev`（默认 127.0.0.1:3000）。

## 快速开始

### 环境要求
- Node.js ≥ 20（推荐 22+，脚本运行需原生 TypeScript 支持）
- npm

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env`，填入你的 API Key：

```bash
cp .env.example .env
```

```env
DEEPSEEK_API_KEY=你的API密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com   # 可选，可指向任意 OpenAI 兼容服务
# LLM_MODEL=mimo-v2.5-pro                    # 可选，自定义模型名
```

> 💡 仅在使用「生成训练计划」功能时才需要 API Key。数据录入与看板功能无需配置。

### 3. （可选）填充动作库

首次使用建议从 wger 拉取动作数据到本地（一次性操作，约 1 分钟）：

```bash
npm run seed:wger
```

执行后会拉取 852 条已审核动作写入本地 SQLite。未填充时训练录入的动作联想仍可工作（仅基于历史记录），填充后可获得完整的动作库补全。

### 4. 启动开发服务器

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000) 即可使用。

## 项目结构

```
body-watcher/
├── src/
│   ├── app/
│   │   ├── api/                  # API 路由
│   │   │   ├── agent/            # AI Agent 流式接口（SSE）
│   │   │   ├── dashboard/        # 看板聚合数据
│   │   │   ├── exercises/        # 动作名 / 历史组数 / 进度 / wger 库搜索
│   │   │   ├── export/           # 数据导出
│   │   │   ├── health/           # 每日健康指标
│   │   │   ├── plans/            # 训练计划
│   │   │   ├── stats/            # 统计
│   │   │   ├── templates/        # 训练模板
│   │   │   └── training/         # 训练记录（增删改查）
│   │   ├── input/page.tsx        # 数据录入页
│   │   ├── plan/page.tsx         # 训练计划页
│   │   ├── layout.tsx            # 根布局（侧边栏 + 暗色主题）
│   │   └── page.tsx              # 看板首页
│   ├── components/               # UI 组件
│   └── lib/
│       ├── agent.ts              # Agent 工具定义与系统提示词
│       ├── db.ts                 # SQLite 数据访问层
│       ├── formulas.ts           # 1RM 估算公式（纯函数）
│       └── llm.ts                # LLM Agent 循环（函数调用 + 流式）
├── scripts/
│   └── seed-wger.ts              # wger 动作库种子脚本（幂等可重跑）
├── data/                         # SQLite 数据库（.gitignore，不入库）
└── .env.example
```

## 数据存储

所有数据存储在项目根目录 `data/body-watcher.db`（SQLite），**该目录已被 `.gitignore` 排除**，不会提交到版本库。主要数据表：

- `daily_health` —— 每日健康指标
- `training_log` / `training_exercise` —— 训练记录与动作明细
- `training_plan` —— AI 生成的训练计划
- `training_template` —— 用户保存的训练模板
- `exercise_library` —— wger 动作库缓存（由 `seed:wger` 填充）

可通过 `/api/export` 导出全部数据。

## NPM 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 生产构建（含 TypeScript 类型检查） |
| `npm start` | 启动生产服务器 |
| `npm run lint` | 运行 ESLint |
| `npm run seed:wger` | 从 wger 拉取动作库到本地（一次性，可重跑） |

## 致谢

- [wger](https://wger.de) —— 开源健身动作数据库（数据遵循其各自许可）
- [Next.js](https://nextjs.org)、[Recharts](https://recharts.org)、[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)

## 许可

MIT
