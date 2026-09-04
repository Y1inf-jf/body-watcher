# Body Watcher

[English](./README.en.md) | 简体中文

> 自建版 Whoop —— Fitbit Air 手环 + 训记训练记录 + 本地恢复算法 + LLM 教练，量化每天的身体状态。

基于 Next.js 16（App Router）+ React 19 + TypeScript + better-sqlite3 构建，Tailwind CSS + Recharts 的暗色 Whoop 风仪表盘。数据全自动入库：手环经 Google Health API、训练经训记 App Open API 镜像，再由确定性算法压成三个数字（恢复分 / 训练状态 / 睡眠需求），LLM 基于这些结果做恢复分析与排课。

## 数据流

```
Fitbit Air 手环 ──→ Google Health 云 ──→ 本应用自动同步（启动时 + 每小时）
训记 App ────────→ Open API ──────────→ 训练动作 × 组 × 重量 × RPE 镜像
                              ↓
                        SQLite（本地）
                              ↓
        确定性算法：恢复分 0-100 · ACWR · Form · 单调性 · 睡眠需求
                              ↓
            仪表盘（圆环仪表）  +  LLM 教练（恢复分析 / 训练计划 / 周总结）
```

## 功能特性

### 🔄 数据自动同步
- **Google Health**：睡眠分期、HRV（rMSSD）、静息心率、呼吸率、SpO₂、步数、体重、训练时长；启动时 + 每小时自动同步，间隔可配
- **训记镜像**：训练日期 → 动作 → 组 × 次数 × 重量 × RPE 全量镜像，动作名关键词推断肌群，`external_id` 幂等去重，支持 96 天以上回补
- 手动录入默认隐藏（路由保留，供"执行计划"预填与编辑流程使用）

### 📈 恢复与训练状态算法
- **恢复分 0-100**：HRV / 静息心率对 21 天个人基线取 z-score + 睡眠债，按 40/30/30 加权经正态 CDF 映射；<34 红（只轻松恢复）/ 34-66 黄（正常练）/ ≥67 绿（可上强度）
- **训练状态**：ACWR 急慢性负荷比（EWMA 7/28 天）、Form 体力-疲劳（CTL-ATL-TSB）、Foster 单调性与 strain
- **睡眠需求推荐**：个人 7 天均值 + 债务补偿 + 昨日负荷
- 全部公式、出处论文与适配取舍见 **[docs/training-algorithms.md](docs/training-algorithms.md)**

### 🤖 AI 教练
- **恢复分析**：LLM 引用恢复分、基线偏离、ACWR 与肌群恢复，给出今日训练强度定位
- **训练计划生成**：综合恢复信号 + 渐进超负荷 + 肌群 48-72h 恢复规则，自动入库
- **周总结**：本周训练概况、亮点与改进建议
- 均为流式输出，可中途取消

### 📊 仪表盘（Whoop 风暗色）
- 恢复分与 ACWR **发光圆环仪表**、28 天负荷迷你柱状图
- HRV / 静息心率 / 睡眠 / 体重体脂渐变趋势图
- 肌群恢复状态、训练日历、渐进超负荷追踪（Epley / Brzycki / Lombardi 三公式 1RM）

## 快速开始

### 环境要求
- Node.js ≥ 20（推荐 22+）
- 一个 OpenAI 兼容的 LLM API Key（默认阿里云百炼）
- Fitbit 手环 + Google 账号、训记 App（分别对应两路数据源；只用其中一路也可以）

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env`，按需填写：

| 变量 | 说明 |
|------|------|
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 任意 OpenAI 兼容端点；默认百炼 `qwen3.8-flash` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | GCP OAuth 客户端凭据（见下节） |
| `GOOGLE_PROXY` | 访问 Google 需代理时填，如 `http://127.0.0.1:7897` |
| `GOOGLE_REDIRECT_URI` | 可选，默认 `http://localhost:3000/api/google/callback` |
| `XUNJI_API_KEY` | 训记 App 内申请的 Open API Key |
| `GOOGLE_SYNC_INTERVAL_MINUTES` | 自动同步间隔，默认 60，0 关闭 |

### 3. 接入 Google Health

1. [console.cloud.google.com](https://console.cloud.google.com) 创建 OAuth 客户端，凭据填入 `.env`
2. 在 OAuth 客户端登记回调地址 `http://localhost:3000/api/google/callback`
3. OAuth 同意屏幕 → Test users 加入你的 Google 账号
4. 打开 `/google` 页，点击"连接 Google Health"完成授权
5. 详细步骤与踩坑记录见 [docs/google-health-spike.md](docs/google-health-spike.md)

> ⚠️ testing 模式下 refresh token 7 天过期，到期后在 `/google` 页重新授权一次即可。

### 4.（可选）填充动作库

```bash
npm run seed:wger
```

### 5. 启动

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。首次建议在 `/google` 页触发一次训记回补（近 31 天 / 更久），恢复基线累计约 5-7 天后各项算法陆续生效。

## 技术栈

| 领域 | 技术 |
|------|------|
| 框架 | Next.js 16.2.7（App Router, Turbopack） |
| 前端 | React 19, TypeScript 5, Tailwind CSS 4, Geist 字体, lucide-react |
| 图表 | Recharts 3（渐变面积图） |
| 数据库 | better-sqlite3（本地 SQLite，WAL 模式） |
| AI | 任意 OpenAI 兼容 API（AI SDK v6 函数调用 + SSE 流式），默认阿里云百炼 `qwen3.8-flash` |
| Google 同步 | Google Health API v4 + OAuth2，undici ProxyAgent 按请求代理 |
| 动作数据 | [wger](https://wger.de) 开源动作数据库 |

## ⚠️ 部署约束（重要）

本项目设计为**单用户本地工具**，未实现任何鉴权：

- 所有 API 路由、数据库均**无用户隔离与身份校验**
- 各类密钥仅存在本地 `.env`（已 gitignore）
- **请勿直接暴露到公网或局域网**。如需远程访问，请自行在前面加反向代理 + 鉴权层

## 数据存储

所有数据在项目根目录 `data/body-watcher.db`（SQLite，已 gitignore）。主要数据表：

- `google_daily_metrics` / `google_raw_data` / `google_oauth_tokens` / `google_sync_log` —— 设备指标、原始数据点、OAuth 凭据与同步日志
- `training_log` / `training_exercise` —— 训练记录与动作明细（`source` 区分 xunji 镜像 / 手动录入）
- `xunji_fetch_log` —— 训记按日拉取记录（礼貌限流）
- `daily_health` / `training_plan` / `training_template` / `exercise_library` —— 手动健康指标、AI 计划、模板、wger 动作库

可通过 `/api/export` 导出全部数据。

## 项目结构

```
body-watcher/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── google/           # OAuth 授权/回调/同步/状态/断开
│   │   │   ├── xunji/            # 训记同步触发与状态
│   │   │   ├── agent/            # AI Agent 流式接口（SSE）
│   │   │   └── ...               # dashboard / training / plans / stats / export 等
│   │   ├── google/page.tsx       # 数据同步页（连接/同步状态/7 天指标）
│   │   ├── plan/page.tsx         # 训练计划页（恢复分析 / 生成计划 / 历史）
│   │   └── page.tsx              # 看板首页（恢复分 + 训练状态圆环仪表）
│   ├── components/
│   │   ├── ui/                   # Card / GaugeRing 等基础组件
│   │   └── ...                   # 仪表盘各卡片与表单
│   ├── lib/
│   │   ├── google/               # Google Health 客户端 / OAuth / 同步解析
│   │   ├── recovery.ts           # 恢复特征 + 恢复分（纯函数）
│   │   ├── training-status.ts    # 负荷 / ACWR / Form / 单调性（纯函数）
│   │   ├── xunji.ts              # 训记 API 客户端与镜像
│   │   ├── agent.ts              # Agent 工具与系统提示词
│   │   ├── db.ts                 # SQLite 数据访问层
│   │   └── llm.ts                # LLM Agent 循环（函数调用 + 流式）
│   └── instrumentation.ts        # 启动 + 每小时自动同步
├── docs/
│   ├── training-algorithms.md    # 恢复与训练状态算法笔记（推荐阅读）
│   └── google-health-spike.md    # Google Health API 接入记录
├── scripts/                      # seed-wger 等脚本
├── data/                         # SQLite 数据库（.gitignore）
└── .env.example
```

## NPM 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 生产构建（含 TypeScript 类型检查） |
| `npm start` | 启动生产服务器 |
| `npm run lint` | 运行 ESLint |
| `npm run seed:wger` | 从 wger 拉取动作库到本地（一次性，可重跑） |

## 致谢

- [wger](https://wger.de) —— 开源健身动作数据库
- Whoop 公开方法论与 [OpenStrap/analytics](https://github.com/OpenStrap/analytics) —— 恢复/负荷算法参考
- [Next.js](https://nextjs.org)、[Recharts](https://recharts.org)、[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)

## 许可

MIT
