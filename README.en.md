# Body Watcher

English | [简体中文](./README.md)

> A personal strength-training tracker and analyzer — log your workouts and health metrics, and let an AI agent generate your next training plan.

Built with Next.js 16 (App Router) + React 19 + TypeScript + better-sqlite3, styled with Tailwind CSS, and charted with Recharts. Plan generation is powered by an LLM agent with Function Calling.

## Features

### 📊 Dashboard
- **Trend charts**: line charts for HRV, resting heart rate, sleep duration, and weight/body-fat over time
- **Recovery panel**: days since each muscle group was last trained, plus 7-day cumulative volume — to judge recovery state
- **Training calendar**: month view of daily workouts and the muscle groups involved
- **Progressive overload tracker**: pick an exercise to see max-weight and estimated 1RM trends, with **switchable Epley / Brzycki / Lombardi formulas**
- **Weekly summary**: the AI auto-summarizes the week's training, highlights, and suggestions

### 📝 Data Entry
- **Daily health metrics**: HRV, resting HR, blood pressure, sleep (duration + quality), weight, body fat, RPE, notes
- **Training log**: multi-exercise, multi-set entry supporting reps / weight / bodyweight / RPE; can be saved as a reusable template
- **wger exercise search**: auto-suggest while typing an exercise name. History entries come first; when insufficient, results are supplemented from the built-in wger library (852 reviewed exercises)

### 🤖 AI Training Plan
- One-click generation of your next training plan — the agent queries your health metrics, muscle-group recovery, and training history automatically
- Factors in progressive overload, muscle recovery (48–72h), and HRV/HR/sleep signals
- Streams the analysis process live; cancellable mid-run
- Plans are saved automatically and viewable on the "Plan" page

## Tech Stack

| Area | Technology |
|------|------------|
| Framework | Next.js 16.2.7 (App Router, Turbopack) |
| Frontend | React 19, TypeScript 5, Tailwind CSS 4 |
| Charts | Recharts 3 |
| Database | better-sqlite3 (local SQLite, WAL mode) |
| AI | Any OpenAI-compatible API (default: DeepSeek), streamed via SSE |
| Exercise data | [wger](https://wger.de) open exercise database |

## Getting Started

### Requirements
- Node.js ≥ 20 (22+ recommended; scripts need native TypeScript support)
- npm

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in your API key:

```bash
cp .env.example .env
```

```env
DEEPSEEK_API_KEY=your_api_key
DEEPSEEK_BASE_URL=https://api.deepseek.com   # optional, can point to any OpenAI-compatible service
# LLM_MODEL=mimo-v2.5-pro                    # optional, custom model name
```

> 💡 An API key is only required for the "Generate Training Plan" feature. Data entry and the dashboard work without one.

### 3. (Optional) Seed the exercise library

On first use, it's recommended to fetch exercise data from wger into local storage (one-time, ~1 minute):

```bash
npm run seed:wger
```

This fetches 852 reviewed exercises into the local SQLite database. Without it, the exercise auto-suggest in the entry form still works (based on your history only); after seeding, you get full library-backed suggestions.

### 4. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to use the app.

## Project Structure

```
body-watcher/
├── src/
│   ├── app/
│   │   ├── api/                  # API routes
│   │   │   ├── agent/            # AI agent streaming endpoint (SSE)
│   │   │   ├── dashboard/        # aggregated dashboard data
│   │   │   ├── exercises/        # names / history sets / progress / wger search
│   │   │   ├── export/           # data export
│   │   │   ├── health/           # daily health metrics
│   │   │   ├── plans/            # training plans
│   │   │   ├── stats/            # statistics
│   │   │   ├── templates/        # training templates
│   │   │   └── training/         # training logs (CRUD)
│   │   ├── input/page.tsx        # data entry page
│   │   ├── plan/page.tsx         # training plan page
│   │   ├── layout.tsx            # root layout (sidebar + dark theme)
│   │   └── page.tsx              # dashboard home
│   ├── components/               # UI components
│   └── lib/
│       ├── agent.ts              # agent tool definitions & system prompt
│       ├── db.ts                 # SQLite data-access layer
│       ├── formulas.ts           # 1RM estimation formulas (pure functions)
│       └── llm.ts                # LLM agent loop (function calling + streaming)
├── scripts/
│   └── seed-wger.ts              # wger library seed script (idempotent, re-runnable)
├── data/                         # SQLite DB (.gitignored, not committed)
└── .env.example
```

## Data Storage

All data is stored in `data/body-watcher.db` (SQLite) at the project root. **This directory is excluded by `.gitignore`** and is never committed. Main tables:

- `daily_health` — daily health metrics
- `training_log` / `training_exercise` — training sessions and exercise details
- `training_plan` — AI-generated training plans
- `training_template` — user-saved training templates
- `exercise_library` — cached wger exercise library (populated by `seed:wger`)

All data can be exported via `/api/export`.

## NPM Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build (includes TypeScript type-check) |
| `npm start` | Start the production server |
| `npm run lint` | Run ESLint |
| `npm run seed:wger` | Fetch the wger exercise library into local DB (one-time, re-runnable) |

## Acknowledgements

- [wger](https://wger.de) — open-source fitness exercise database (data under its respective licenses)
- [Next.js](https://nextjs.org), [Recharts](https://recharts.org), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)

## License

MIT
