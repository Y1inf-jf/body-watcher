# Body Watcher

English | [简体中文](./README.md)

> A self-hosted Whoop — Fitbit Air band + gym-log data + local recovery algorithms + an LLM coach, quantifying your body state every day.

Built with Next.js 16 (App Router) + React 19 + TypeScript + better-sqlite3, with a dark Whoop-style dashboard in Tailwind CSS + Recharts. All data flows in automatically: wearable metrics via the Google Health API, workouts mirrored from the XunJi gym-logging app. Deterministic algorithms compress them into three numbers (recovery score / training status / sleep need), and an LLM coach turns those into daily recovery analysis and training plans.

## Data Flow

```
Fitbit band ──→ Google Health cloud ──→ auto sync (startup + hourly)
XunJi app ─────→ Open API ───────────→ exercise × set × weight × RPE mirror
                              ↓
                        SQLite (local)
                              ↓
     Deterministic algorithms: recovery 0-100 · ACWR · Form · monotony · sleep need
                              ↓
        Dashboard (gauge rings)  +  LLM coach (recovery / plans / weekly summary)
```

## Features

### 🔄 Automatic data sync
- **Google Health**: sleep stages, HRV (rMSSD), resting HR, respiratory rate, SpO₂, steps, weight, workout minutes; synced at startup and hourly (configurable)
- **XunJi mirror**: date → exercise → set × reps × weight × RPE fully mirrored, muscle groups inferred from exercise-name keywords, idempotent via `external_id`, backfill supported
- Manual entry is hidden by default (route kept for plan-execution prefill and editing)

### 📈 Recovery & training-status algorithms
- **Recovery score 0-100**: HRV / resting HR z-scored against a 21-day personal baseline plus sleep debt, weighted 40/30/30 and mapped through a normal CDF; <34 red (take it easy) / 34-66 yellow (train normally) / ≥67 green (push hard)
- **Training status**: ACWR acute:chronic ratio (EWMA 7/28d), Form fitness-fatigue (CTL-ATL-TSB), Foster monotony & strain
- **Sleep-need recommendation**: personal 7-day average + debt repayment + yesterday's load
- Full formulas, references, and adaptation notes in **[docs/training-algorithms.md](docs/training-algorithms.md)** (Chinese)

### 🤖 AI coach
- **Recovery analysis**: the LLM cites your recovery score, baseline deviations, ACWR, and muscle-group recovery to position today's training intensity
- **Plan generation**: progressive overload + 48-72h muscle recovery + recovery signals, auto-saved
- **Weekly summary**: highlights and adjustments
- All streams are live and cancellable

### 📊 Dashboard (Whoop-style dark UI)
- Glowing **gauge rings** for recovery score and ACWR, 28-day load bars
- Gradient area charts for HRV / resting HR / sleep / weight & body fat
- Muscle-group recovery, training calendar, progressive-overload tracker (Epley / Brzycki / Lombardi 1RM)

## Getting Started

### Requirements
- Node.js ≥ 20 (22+ recommended)
- An OpenAI-compatible LLM API key (Bailian by default)
- A Fitbit band + Google account, and the XunJi app for workout data (either source works alone)

### 1. Install

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env`:

| Variable | Description |
|----------|-------------|
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | Any OpenAI-compatible endpoint; defaults to Bailian `qwen3.8-flash` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | GCP OAuth client credentials (see below) |
| `GOOGLE_PROXY` | Proxy for reaching Google, e.g. `http://127.0.0.1:7897` |
| `GOOGLE_REDIRECT_URI` | Optional, defaults to `http://localhost:3000/api/google/callback` |
| `XUNJI_API_KEY` | XunJi app Open API key |
| `GOOGLE_SYNC_INTERVAL_MINUTES` | Sync interval, default 60, 0 disables |
| `AUTH_PASSWORD_HASH` | **Required for login.** scrypt hash of the password; see `.env.example` (use `:` as separator, not `$`) |
| `SESSION_SECRET` | **Required for login.** HMAC signing key for the session cookie; 32 random bytes in hex |

> `LLM_API_KEY` can also be configured on the `/settings` page (stored in the `app_settings` table; precedence DB > `.env` > built-in default). The GET endpoint returns a masked value only.

### 3. Connect Google Health

1. Create an OAuth client at [console.cloud.google.com](https://console.cloud.google.com) and fill in the credentials
2. Register the redirect URI `http://localhost:3000/api/google/callback`
3. Add your Google account as a Test user on the OAuth consent screen
4. Open `/google` and click "Connect Google Health"
5. Full walkthrough and pitfalls: [docs/google-health-spike.md](docs/google-health-spike.md) (Chinese)

> ⚠️ In testing mode the refresh token expires every 7 days — re-authorize on `/google` when that happens.

### 4. (Optional) Seed the exercise library

```bash
npm run seed:wger
```

### 5. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Trigger a XunJi backfill on `/google` on first run; recovery baselines need ~5-7 days of nightly wear before every algorithm activates.

## Tech Stack

| Area | Tech |
|------|------|
| Framework | Next.js 16.2.7 (App Router, Turbopack) |
| Frontend | React 19, TypeScript 5, Tailwind CSS 4, Geist fonts, lucide-react |
| Charts | Recharts 3 (gradient area charts) |
| Database | better-sqlite3 (local SQLite, WAL mode) |
| AI | Any OpenAI-compatible API (AI SDK v6 function calling + plain-text streaming), Bailian `qwen3.8-flash` by default |
| Google sync | Google Health API v4 + OAuth2, per-request undici ProxyAgent |
| Exercise data | [wger](https://wger.de) open exercise database |

## 🔒 Authentication & Deployment

Single-user tool, but it **ships with a site-wide login wall**, so it is safe to expose publicly:

- **Login wall**: `src/proxy.ts` (Middleware was renamed to Proxy in Next 16) guards every page and API route —
  unauthenticated page requests get a 302 to `/login`, API requests get a 401 JSON response. Only
  `/login`, `/api/auth/login` and `/api/auth/logout` are public.
- **Sessions**: the `bw_session` cookie is `<expiry-timestamp>.<HMAC-SHA256 signature>` — stateless, built on
  Web Crypto only (so it behaves identically in the Edge proxy and Node routes), verified with a
  constant-time comparison. The password itself is never stored in the cookie; `.env` holds only a scrypt hash.
- **Login throttling**: graduated backoff per client IP — 3 failures lock for 30s, 5 for 5 minutes,
  8 for 30 minutes. The counter is **cumulative** and only resets on a successful login or after an
  hour with no failures; once you reach a tier, every further failure re-arms that tier's timer
  (it is *not* "lock once, then get free attempts again") — otherwise an attacker would regain three
  free tries each round and never reach the longer tiers. While locked it returns 429 + `Retry-After`
  and **skips scrypt entirely** (otherwise the limiter itself becomes a CPU amplifier). The key is the
  `X-Real-IP` header injected by nginx: this project's `X-Forwarded-For` uses append semantics, so its
  leftmost value is client-supplied and spoofable — keying on it would mean no throttling at all.
- **Secrets** live only in `.env` (gitignored) — never in the database or in git. The database is a single SQLite file.
- **Still single-user by design**: no multi-tenant isolation and no row-level permissions. That is a deliberate
  trade-off, not an oversight.

> ⚠️ When exposing it publicly, put it behind HTTPS and enable the `Secure` flag on the login cookie
> (see the comment in `src/app/api/auth/login/route.ts`). Over plain HTTP the session cookie can be intercepted.

## Data Storage

All data lives in `data/body-watcher.db` (SQLite, gitignored). Main tables:

- `google_daily_metrics` / `google_raw_data` / `google_oauth_tokens` / `google_sync_log` — device metrics, raw datapoints, OAuth credentials, sync log
- `training_log` / `training_exercise` — workouts and exercise details (`source` distinguishes xunji mirror vs manual)
- `xunji_fetch_log` — per-date fetch log for polite rate limiting
- `daily_health` / `training_plan` / `training_template` / `exercise_library` — manual metrics, AI plans, templates, wger library
- `advice_log` — daily and plan advice, including follow-through status and felt-RPE feedback (the advice loop)
- `recovery_snapshots` — one recovery snapshot per day, input for period reviews (written by both the sync job and the dashboard)
- `insights` — fired proactive insight rules, deduped by `(rule_id, date)`
- `coach_notes` — long-term coach notes (hard-constraint flag and expiry)
- `chat_sessions` / `chat_messages` — coach conversation history
- `period_reports` / `app_settings` — saved period reports and settings (including LLM config overrides)

Export everything via `/api/export`.

## Project Structure

```
body-watcher/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── google/           # OAuth auth/callback/sync/status/disconnect
│   │   │   ├── xunji/            # XunJi sync trigger & status
│   │   │   ├── agent/            # AI agent streaming endpoint (plain text)
│   │   │   ├── auth/             # login / logout
│   │   │   └── ...               # dashboard / training / plans / advice / stats / export
│   │   ├── login/page.tsx        # Login page
│   │   ├── google/page.tsx       # Sync page (connect / status / 7-day metrics)
│   │   ├── plan/page.tsx         # Plan page (recovery analysis / generation / history)
│   │   ├── settings/page.tsx     # Settings (profile / sleep targets / LLM config)
│   │   └── page.tsx              # Dashboard (recovery + training-status gauge rings)
│   ├── components/
│   │   ├── ui/                   # Card / GaugeRing primitives
│   │   └── ...                   # dashboard cards & forms
│   ├── lib/
│   │   ├── google/               # Google Health client / OAuth / sync parsing
│   │   ├── recovery.ts           # recovery features + score (pure functions)
│   │   ├── training-status.ts    # load / ACWR / Form / monotony (pure functions)
│   │   ├── readiness.ts          # recovery × load → today's train/rest verdict (pure)
│   │   ├── daily-context.ts      # single source of truth + daily settle (dashboard/insights/coach)
│   │   ├── insights.ts           # proactive insight rule engine
│   │   ├── auth.ts               # session signing & verification (HMAC, Web Crypto)
│   │   ├── login-throttle.ts     # graduated login-failure throttling (in-process)
│   │   ├── xunji.ts              # XunJi API client & mirror
│   │   ├── agent.ts              # agent tools & system prompts
│   │   ├── db.ts                 # SQLite data layer
│   │   └── llm.ts                # LLM agent loop (function calling + streaming)
│   ├── proxy.ts                  # site-wide login wall (Middleware renamed to Proxy in Next 16)
│   └── instrumentation.ts        # startup + hourly sync → daily settle → recompute insights
├── docs/
│   ├── training-algorithms.md    # algorithm study notes (Chinese)
│   ├── google-health-spike.md    # Google Health API integration log (Chinese)
│   └── privacy-policy.md         # privacy notes (Chinese)
├── tests/
│   └── regression.test.mts       # regression tests (node:test, run via npm test)
├── scripts/
│   └── seed-wger.ts              # pull the wger exercise library (one-off)
├── data/                         # SQLite database (gitignored)
└── .env.example
```

## NPM Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build
 (includes type check) |
| `npm start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run seed:wger` | Pull wger exercise library (idempotent) |
| `npm test` | Run the regression tests (Node's built-in `node:test`, 40 cases / 52 assertions) |
| `npm run check` | Type check + lint + tests (one-shot pre-commit gate) |

## Acknowledgements

- [wger](https://wger.de) — open exercise database
- Whoop's public methodology and [OpenStrap/analytics](https://github.com/OpenStrap/analytics) — recovery/load algorithm references
- [Next.js](https://nextjs.org), [Recharts](https://recharts.org), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)

## License

MIT
