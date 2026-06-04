# Body Watcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal strength training analysis tool where an LLM Agent generates training plans based on manually-inputted health metrics and training history.

**Architecture:** Next.js 15 full-stack app with SQLite for local data storage. Agent uses DeepSeek API via Vercel AI SDK with Function Calling to query user data and generate plans. SSE streaming for real-time agent output.

**Tech Stack:** Next.js 15, TypeScript, TailwindCSS, Recharts, better-sqlite3, Vercel AI SDK, DeepSeek API

---

## File Structure

```
body-watcher/
├── src/
│   ├── app/
│   │   ├── globals.css
│   │   ├── layout.tsx              # Root layout with dark theme + nav
│   │   ├── page.tsx                # Dashboard
│   │   ├── input/page.tsx          # Data input (health + training forms)
│   │   ├── plan/page.tsx           # Training plan generation + history
│   │   └── api/
│   │       ├── health/route.ts     # GET/POST daily health metrics
│   │       ├── training/route.ts   # GET/POST training logs + exercises
│   │       ├── dashboard/route.ts  # GET aggregated dashboard data
│   │       └── agent/route.ts      # POST agent generate plan (SSE)
│   ├── lib/
│   │   ├── db.ts                   # SQLite init, schema, all queries
│   │   ├── agent.ts                # Agent tools + system prompt + orchestration
│   │   └── llm.ts                  # Vercel AI SDK provider setup
│   └── components/
│       ├── Sidebar.tsx             # Navigation sidebar
│       ├── HealthForm.tsx          # Daily health metrics form
│       ├── TrainingForm.tsx        # Training log form with exercises
│       ├── TrendChart.tsx          # Recharts line chart wrapper
│       ├── RecoveryPanel.tsx       # Muscle recovery status cards
│       └── PlanCard.tsx            # Training plan display card
├── data/                           # SQLite DB file (gitignored)
├── .env                            # DEEPSEEK_API_KEY
├── .env.example                    # Template for .env
└── package.json
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json` (via create-next-app)
- Create: `src/app/layout.tsx`
- Create: `src/app/globals.css`
- Create: `.env.example`
- Create: `.env`

- [ ] **Step 1: Initialize Next.js project**

```bash
cd D:\test_projects
npx create-next-app@latest body-watcher --typescript --tailwind --eslint --app --src-dir --no-import-alias --use-npm
```

Accept all defaults. This creates the project with TypeScript, Tailwind, App Router.

- [ ] **Step 2: Install dependencies**

```bash
cd D:\test_projects\body-watcher
npm install better-sqlite3 ai @ai-sdk/openai recharts date-fns
npm install -D @types/better-sqlite3
```

- [ ] **Step 3: Create .env files**

Create `.env.example`:
```
DEEPSEEK_API_KEY=your-api-key-here
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

Create `.env`:
```
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

- [ ] **Step 4: Set up root layout with dark theme**

Replace `src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "Body Watcher",
  description: "个人力量训练分析工具",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className="dark">
      <body className="bg-zinc-950 text-zinc-100 min-h-screen">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 p-6 overflow-auto">{children}</main>
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Create Sidebar component**

Create `src/components/Sidebar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "总览" },
  { href: "/input", label: "数据录入" },
  { href: "/plan", label: "训练计划" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="w-48 border-r border-zinc-800 p-4 flex flex-col gap-2">
      <h1 className="text-lg font-bold mb-4 text-zinc-100">Body Watcher</h1>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`px-3 py-2 rounded text-sm transition-colors ${
            pathname === link.href
              ? "bg-zinc-800 text-white"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
          }`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 6: Update globals.css for dark theme**

Replace `src/app/globals.css`:

```css
@import "tailwindcss";

:root {
  --background: #09090b;
  --foreground: #fafafa;
}

body {
  color: var(--foreground);
  background: var(--background);
}

input[type="number"]::-webkit-inner-spin-button,
input[type="number"]::-webkit-outer-spin-button {
  -webkit-appearance: none;
}
```

- [ ] **Step 7: Create data directory and .gitignore entry**

```bash
mkdir -p data
```

Add to `.gitignore` (append if not present):
```
data/*.db
.env
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: project scaffolding with Next.js, Tailwind, dark theme layout"
```

---

### Task 2: Database Layer

**Files:**
- Create: `src/lib/db.ts`

- [ ] **Step 1: Write the database module**

Create `src/lib/db.ts`:

```ts
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "body-watcher.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  createTables(_db);
  return _db;
}

function createTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_health (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      hrv REAL,
      resting_hr REAL,
      systolic INTEGER,
      diastolic INTEGER,
      sleep_hours REAL,
      sleep_quality INTEGER,
      weight REAL,
      body_fat REAL,
      rpe INTEGER,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS training_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      duration INTEGER,
      total_volume REAL,
      rpe INTEGER,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS training_exercise (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      training_log_id INTEGER NOT NULL,
      exercise_name TEXT NOT NULL,
      muscle_group TEXT NOT NULL,
      sets INTEGER,
      reps INTEGER,
      weight REAL,
      FOREIGN KEY (training_log_id) REFERENCES training_log(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS training_plan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      plan_date TEXT,
      analysis_summary TEXT,
      recovery_assessment TEXT,
      exercises TEXT,
      advice TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
  `);
}

// --- Health queries ---

export function upsertHealth(data: {
  date: string;
  hrv?: number;
  resting_hr?: number;
  systolic?: number;
  diastolic?: number;
  sleep_hours?: number;
  sleep_quality?: number;
  weight?: number;
  body_fat?: number;
  rpe?: number;
  notes?: string;
}) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO daily_health (date, hrv, resting_hr, systolic, diastolic, sleep_hours, sleep_quality, weight, body_fat, rpe, notes)
    VALUES (@date, @hrv, @resting_hr, @systolic, @diastolic, @sleep_hours, @sleep_quality, @weight, @body_fat, @rpe, @notes)
    ON CONFLICT(date) DO UPDATE SET
      hrv = COALESCE(excluded.hrv, daily_health.hrv),
      resting_hr = COALESCE(excluded.resting_hr, daily_health.resting_hr),
      systolic = COALESCE(excluded.systolic, daily_health.systolic),
      diastolic = COALESCE(excluded.diastolic, daily_health.diastolic),
      sleep_hours = COALESCE(excluded.sleep_hours, daily_health.sleep_hours),
      sleep_quality = COALESCE(excluded.sleep_quality, daily_health.sleep_quality),
      weight = COALESCE(excluded.weight, daily_health.weight),
      body_fat = COALESCE(excluded.body_fat, daily_health.body_fat),
      rpe = COALESCE(excluded.rpe, daily_health.rpe),
      notes = COALESCE(excluded.notes, daily_health.notes)
  `).run(data);
}

export function queryHealthMetrics(days: number) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM daily_health
    WHERE date >= date('now', '-' || ? || ' days')
    ORDER BY date DESC
  `).all(days);
}

export function getLatestHealth() {
  const db = getDb();
  return db.prepare(`SELECT * FROM daily_health ORDER BY date DESC LIMIT 1`).get() as Record<string, unknown> | undefined;
}

// --- Training queries ---

export function insertTrainingLog(data: {
  date: string;
  duration?: number;
  total_volume?: number;
  rpe?: number;
  notes?: string;
}, exercises: {
  exercise_name: string;
  muscle_group: string;
  sets?: number;
  reps?: number;
  weight?: number;
}[]) {
  const db = getDb();
  const insertLog = db.prepare(`
    INSERT INTO training_log (date, duration, total_volume, rpe, notes)
    VALUES (@date, @duration, @total_volume, @rpe, @notes)
  `);
  const insertExercise = db.prepare(`
    INSERT INTO training_exercise (training_log_id, exercise_name, muscle_group, sets, reps, weight)
    VALUES (?, @exercise_name, @muscle_group, @sets, @reps, @weight)
  `);

  const transaction = db.transaction(() => {
    const result = insertLog.run(data);
    const logId = result.lastInsertRowid;
    for (const ex of exercises) {
      insertExercise.run(logId, ex);
    }
    return logId;
  });

  return transaction();
}

export function queryTrainingHistory(days: number) {
  const db = getDb();
  return db.prepare(`
    SELECT tl.*, GROUP_CONCAT(
      te.exercise_name || ':' || te.muscle_group || ':' || COALESCE(te.sets,0) || 'x' || COALESCE(te.reps,0) || '@' || COALESCE(te.weight,0),
      ' | '
    ) as exercises
    FROM training_log tl
    LEFT JOIN training_exercise te ON te.training_log_id = tl.id
    WHERE tl.date >= date('now', '-' || ? || ' days')
    GROUP BY tl.id
    ORDER BY tl.date DESC
  `).all(days);
}

export function queryTrainingHistoryDetailed(days: number) {
  const db = getDb();
  const logs = db.prepare(`
    SELECT * FROM training_log
    WHERE date >= date('now', '-' || ? || ' days')
    ORDER BY date DESC
  `).all(days) as Record<string, unknown>[];

  for (const log of logs) {
    const exercises = db.prepare(`
      SELECT * FROM training_exercise WHERE training_log_id = ?
    `).all(log.id);
    (log as Record<string, unknown>).exercises = exercises;
  }
  return logs;
}

// --- Muscle recovery ---

export function queryMuscleRecovery() {
  const db = getDb();
  return db.prepare(`
    SELECT
      te.muscle_group,
      MAX(tl.date) as last_trained,
      CAST(julianday('now') - julianday(MAX(tl.date)) AS INTEGER) as days_since,
      SUM(te.sets * te.reps * te.weight) as total_volume_7d
    FROM training_exercise te
    JOIN training_log tl ON tl.id = te.training_log_id
    WHERE tl.date >= date('now', '-7 days')
    GROUP BY te.muscle_group
    ORDER BY days_since ASC
  `).all();
}

// --- Body composition ---

export function queryBodyComposition(days: number) {
  const db = getDb();
  return db.prepare(`
    SELECT date, weight, body_fat FROM daily_health
    WHERE weight IS NOT NULL AND date >= date('now', '-' || ? || ' days')
    ORDER BY date ASC
  `).all(days);
}

// --- Training plan ---

export function saveTrainingPlan(plan: {
  date: string;
  plan_date?: string;
  analysis_summary: string;
  recovery_assessment: string;
  exercises: string;
  advice: string;
}) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO training_plan (date, plan_date, analysis_summary, recovery_assessment, exercises, advice)
    VALUES (@date, @plan_date, @analysis_summary, @recovery_assessment, @exercises, @advice)
  `).run(plan);
}

export function getTrainingPlans(limit: number = 20) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM training_plan ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}

// --- Recent training for dashboard ---

export function getRecentTrainings(limit: number = 5) {
  const db = getDb();
  const logs = db.prepare(`
    SELECT * FROM training_log ORDER BY date DESC LIMIT ?
  `).all(limit) as Record<string, unknown>[];

  for (const log of logs) {
    const exercises = db.prepare(`
      SELECT * FROM training_exercise WHERE training_log_id = ?
    `).all(log.id);
    (log as Record<string, unknown>).exercises = exercises;
  }
  return logs;
}
```

- [ ] **Step 2: Verify database initializes**

Start the Next.js dev server briefly to ensure no import errors:

```bash
npx next build 2>&1 | head -20
```

Expected: Build succeeds or shows only page-level errors (no db.ts errors).

- [ ] **Step 3: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat: database layer with SQLite schema and all query functions"
```

---

### Task 3: Health API Route

**Files:**
- Create: `src/app/api/health/route.ts`

- [ ] **Step 1: Create the health API route**

Create `src/app/api/health/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { upsertHealth, queryHealthMetrics, getLatestHealth } from "@/lib/db";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { date, hrv, resting_hr, systolic, diastolic, sleep_hours, sleep_quality, weight, body_fat, rpe, notes } = body;

  if (!date) {
    return NextResponse.json({ error: "date is required" }, { status: 400 });
  }

  upsertHealth({
    date,
    hrv: hrv || null,
    resting_hr: resting_hr || null,
    systolic: systolic || null,
    diastolic: diastolic || null,
    sleep_hours: sleep_hours || null,
    sleep_quality: sleep_quality || null,
    weight: weight || null,
    body_fat: body_fat || null,
    rpe: rpe || null,
    notes: notes || null,
  });

  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "30");

  const metrics = queryHealthMetrics(days);
  const latest = getLatestHealth();

  return NextResponse.json({ metrics, latest });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/health/route.ts
git commit -m "feat: health metrics API route with GET/POST"
```

---

### Task 4: Training API Route

**Files:**
- Create: `src/app/api/training/route.ts`

- [ ] **Step 1: Create the training API route**

Create `src/app/api/training/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { insertTrainingLog, queryTrainingHistoryDetailed, getRecentTrainings } from "@/lib/db";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { date, duration, rpe, notes, exercises } = body;

  if (!date || !exercises?.length) {
    return NextResponse.json({ error: "date and exercises are required" }, { status: 400 });
  }

  const total_volume = exercises.reduce(
    (sum: number, ex: { sets?: number; reps?: number; weight?: number }) =>
      sum + (ex.sets || 0) * (ex.reps || 0) * (ex.weight || 0),
    0
  );

  const logId = insertTrainingLog(
    { date, duration: duration || null, total_volume, rpe: rpe || null, notes: notes || null },
    exercises
  );

  return NextResponse.json({ ok: true, id: logId });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "30");
  const recent = searchParams.get("recent");

  if (recent) {
    const limit = parseInt(recent) || 5;
    const logs = getRecentTrainings(limit);
    return NextResponse.json({ logs });
  }

  const history = queryTrainingHistoryDetailed(days);
  return NextResponse.json({ history });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/training/route.ts
git commit -m "feat: training log API route with GET/POST"
```

---

### Task 5: Dashboard API Route

**Files:**
- Create: `src/app/api/dashboard/route.ts`

- [ ] **Step 1: Create the dashboard aggregation API**

Create `src/app/api/dashboard/route.ts`:

```ts
import { NextResponse } from "next/server";
import { queryHealthMetrics, queryMuscleRecovery, getRecentTrainings, queryBodyComposition } from "@/lib/db";

export async function GET() {
  const healthMetrics = queryHealthMetrics(30);
  const muscleRecovery = queryMuscleRecovery();
  const recentTrainings = getRecentTrainings(5);
  const bodyComposition = queryBodyComposition(30);

  return NextResponse.json({
    healthMetrics,
    muscleRecovery,
    recentTrainings,
    bodyComposition,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/dashboard/route.ts
git commit -m "feat: dashboard aggregation API route"
```

---

### Task 6: Health Input Form Component

**Files:**
- Create: `src/components/HealthForm.tsx`

- [ ] **Step 1: Create the health form component**

Create `src/components/HealthForm.tsx`:

```tsx
"use client";

import { useState, useEffect } from "react";

interface HealthData {
  date: string;
  hrv: string;
  resting_hr: string;
  systolic: string;
  diastolic: string;
  sleep_hours: string;
  sleep_quality: string;
  weight: string;
  body_fat: string;
  rpe: string;
  notes: string;
}

const defaultData: HealthData = {
  date: new Date().toISOString().split("T")[0],
  hrv: "",
  resting_hr: "",
  systolic: "",
  diastolic: "",
  sleep_hours: "",
  sleep_quality: "",
  weight: "",
  body_fat: "",
  rpe: "",
  notes: "",
};

export default function HealthForm() {
  const [data, setData] = useState<HealthData>(defaultData);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/health?days=1")
      .then((r) => r.json())
      .then((res) => {
        if (res.latest) {
          const l = res.latest as Record<string, unknown>;
          setData((prev) => ({
            ...prev,
            weight: l.weight ? String(l.weight) : prev.weight,
            body_fat: l.body_fat ? String(l.body_fat) : prev.body_fat,
          }));
        }
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    const body: Record<string, unknown> = { date: data.date };
    const fields = ["hrv", "resting_hr", "systolic", "diastolic", "sleep_hours", "sleep_quality", "weight", "body_fat", "rpe"] as const;
    for (const f of fields) {
      if (data[f]) body[f] = parseFloat(data[f]);
    }
    if (data.notes) body.notes = data.notes;

    const res = await fetch("/api/health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setSaving(false);
    if (res.ok) {
      setMessage("已保存");
      setTimeout(() => setMessage(""), 2000);
    } else {
      setMessage("保存失败");
    }
  };

  const fields = [
    { key: "hrv", label: "HRV (ms)", placeholder: "45" },
    { key: "resting_hr", label: "静息心率", placeholder: "62" },
    { key: "systolic", label: "收缩压", placeholder: "120" },
    { key: "diastolic", label: "舒张压", placeholder: "80" },
    { key: "sleep_hours", label: "睡眠 (h)", placeholder: "7.5" },
    { key: "sleep_quality", label: "睡眠质量 (1-10)", placeholder: "7" },
    { key: "weight", label: "体重 (kg)", placeholder: "75" },
    { key: "body_fat", label: "体脂 (%)", placeholder: "15" },
    { key: "rpe", label: "疲劳感 (1-10)", placeholder: "5" },
  ] as const;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center gap-4">
        <input
          type="date"
          value={data.date}
          onChange={(e) => setData({ ...data, date: e.target.value })}
          className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-1.5 rounded text-sm font-medium"
        >
          {saving ? "保存中..." : "保存"}
        </button>
        {message && <span className="text-sm text-green-400">{message}</span>}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {fields.map(({ key, label, placeholder }) => (
          <div key={key}>
            <label className="block text-xs text-zinc-400 mb-1">{label}</label>
            <input
              type="number"
              step="any"
              placeholder={placeholder}
              value={data[key]}
              onChange={(e) => setData({ ...data, [key]: e.target.value })}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm"
            />
          </div>
        ))}
      </div>
      <div>
        <label className="block text-xs text-zinc-400 mb-1">备注</label>
        <input
          type="text"
          value={data.notes}
          onChange={(e) => setData({ ...data, notes: e.target.value })}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm"
          placeholder="今天状态如何..."
        />
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/HealthForm.tsx
git commit -m "feat: health metrics input form with smart defaults"
```

---

### Task 7: Training Input Form Component

**Files:**
- Create: `src/components/TrainingForm.tsx`

- [ ] **Step 1: Create the training form component**

Create `src/components/TrainingForm.tsx`:

```tsx
"use client";

import { useState } from "react";

interface Exercise {
  exercise_name: string;
  muscle_group: string;
  sets: string;
  reps: string;
  weight: string;
}

const MUSCLE_GROUPS = ["胸", "背", "腿", "肩", "手臂", "核心"];

export default function TrainingForm() {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [duration, setDuration] = useState("");
  const [rpe, setRpe] = useState("");
  const [notes, setNotes] = useState("");
  const [exercises, setExercises] = useState<Exercise[]>([
    { exercise_name: "", muscle_group: "胸", sets: "", reps: "", weight: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const updateExercise = (index: number, field: keyof Exercise, value: string) => {
    setExercises((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const addExercise = () => {
    setExercises((prev) => [
      ...prev,
      { exercise_name: "", muscle_group: "胸", sets: "", reps: "", weight: "" },
    ]);
  };

  const removeExercise = (index: number) => {
    setExercises((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    const body = {
      date,
      duration: duration ? parseInt(duration) : null,
      rpe: rpe ? parseInt(rpe) : null,
      notes: notes || null,
      exercises: exercises.map((ex) => ({
        exercise_name: ex.exercise_name,
        muscle_group: ex.muscle_group,
        sets: ex.sets ? parseInt(ex.sets) : null,
        reps: ex.reps ? parseInt(ex.reps) : null,
        weight: ex.weight ? parseFloat(ex.weight) : null,
      })),
    };

    const res = await fetch("/api/training", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setSaving(false);
    if (res.ok) {
      setMessage("已保存");
      setExercises([{ exercise_name: "", muscle_group: "胸", sets: "", reps: "", weight: "" }]);
      setDuration("");
      setRpe("");
      setNotes("");
      setTimeout(() => setMessage(""), 2000);
    } else {
      setMessage("保存失败");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center gap-4">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm"
        />
        <input
          type="number"
          placeholder="时长 (min)"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm w-28"
        />
        <input
          type="number"
          placeholder="RPE (1-10)"
          value={rpe}
          onChange={(e) => setRpe(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm w-28"
        />
        <button
          type="submit"
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-1.5 rounded text-sm font-medium"
        >
          {saving ? "保存中..." : "保存训练"}
        </button>
        {message && <span className="text-sm text-green-400">{message}</span>}
      </div>

      <div className="space-y-2">
        {exercises.map((ex, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              placeholder="动作名称"
              value={ex.exercise_name}
              onChange={(e) => updateExercise(i, "exercise_name", e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm flex-1"
            />
            <select
              value={ex.muscle_group}
              onChange={(e) => updateExercise(i, "muscle_group", e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm"
            >
              {MUSCLE_GROUPS.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <input
              type="number"
              placeholder="组"
              value={ex.sets}
              onChange={(e) => updateExercise(i, "sets", e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm w-16"
            />
            <input
              type="number"
              placeholder="次"
              value={ex.reps}
              onChange={(e) => updateExercise(i, "reps", e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm w-16"
            />
            <input
              type="number"
              step="any"
              placeholder="kg"
              value={ex.weight}
              onChange={(e) => updateExercise(i, "weight", e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm w-20"
            />
            {exercises.length > 1 && (
              <button
                type="button"
                onClick={() => removeExercise(i)}
                className="text-red-400 hover:text-red-300 text-sm px-2"
              >
                x
              </button>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addExercise}
        className="text-blue-400 hover:text-blue-300 text-sm"
      >
        + 添加动作
      </button>

      <div>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="训练备注..."
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm"
        />
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/TrainingForm.tsx
git commit -m "feat: training log input form with dynamic exercises"
```

---

### Task 8: Input Page

**Files:**
- Create: `src/app/input/page.tsx`

- [ ] **Step 1: Create the input page**

Create `src/app/input/page.tsx`:

```tsx
import HealthForm from "@/components/HealthForm";
import TrainingForm from "@/components/TrainingForm";

export default function InputPage() {
  return (
    <div className="max-w-4xl space-y-8">
      <section>
        <h2 className="text-lg font-semibold mb-3">每日健康指标</h2>
        <HealthForm />
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-3">训练记录</h2>
        <TrainingForm />
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/input/page.tsx
git commit -m "feat: input page combining health and training forms"
```

---

### Task 9: Trend Chart Component

**Files:**
- Create: `src/components/TrendChart.tsx`

- [ ] **Step 1: Create the chart component**

Create `src/components/TrendChart.tsx`:

```tsx
"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface DataPoint {
  date: string;
  [key: string]: string | number | null;
}

interface Series {
  dataKey: string;
  color: string;
  name: string;
}

interface TrendChartProps {
  title: string;
  data: DataPoint[];
  series: Series[];
}

export default function TrendChart({ title, data, series }: TrendChartProps) {
  if (!data.length) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-zinc-400 mb-2">{title}</h3>
        <p className="text-zinc-600 text-sm">暂无数据</p>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-zinc-400 mb-2">{title}</h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#71717a" }} />
          <YAxis tick={{ fontSize: 11, fill: "#71717a" }} width={40} />
          <Tooltip
            contentStyle={{
              backgroundColor: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: "6px",
              fontSize: 12,
            }}
          />
          {series.map((s) => (
            <Line
              key={s.dataKey}
              type="monotone"
              dataKey={s.dataKey}
              stroke={s.color}
              name={s.name}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/TrendChart.tsx
git commit -m "feat: reusable trend chart component with Recharts"
```

---

### Task 10: Recovery Panel Component

**Files:**
- Create: `src/components/RecoveryPanel.tsx`

- [ ] **Step 1: Create the recovery panel component**

Create `src/components/RecoveryPanel.tsx`:

```tsx
"use client";

interface MuscleRecovery {
  muscle_group: string;
  last_trained: string;
  days_since: number;
  total_volume_7d: number | null;
}

interface RecoveryPanelProps {
  data: MuscleRecovery[];
}

function getStatus(daysSince: number): { label: string; color: string } {
  if (daysSince >= 3) return { label: "可训练", color: "bg-green-600" };
  if (daysSince >= 2) return { label: "恢复中", color: "bg-yellow-600" };
  return { label: "需休息", color: "bg-red-600" };
}

export default function RecoveryPanel({ data }: RecoveryPanelProps) {
  if (!data.length) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-zinc-400 mb-2">肌群恢复状态</h3>
        <p className="text-zinc-600 text-sm">暂无训练数据</p>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-zinc-400 mb-3">肌群恢复状态</h3>
      <div className="grid grid-cols-3 gap-2">
        {data.map((m) => {
          const status = getStatus(m.days_since);
          return (
            <div
              key={m.muscle_group}
              className="border border-zinc-800 rounded p-2 text-center"
            >
              <div className="font-medium text-sm">{m.muscle_group}</div>
              <div className={`inline-block mt-1 px-2 py-0.5 rounded text-xs text-white ${status.color}`}>
                {status.label}
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                {m.days_since} 天前训练
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/RecoveryPanel.tsx
git commit -m "feat: muscle recovery status panel with color indicators"
```

---

### Task 11: Dashboard Page

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/components/PlanCard.tsx`

- [ ] **Step 1: Create PlanCard component**

Create `src/components/PlanCard.tsx`:

```tsx
"use client";

interface TrainingLog {
  id: number;
  date: string;
  duration: number | null;
  total_volume: number | null;
  rpe: number | null;
  notes: string | null;
  exercises: {
    exercise_name: string;
    muscle_group: string;
    sets: number | null;
    reps: number | null;
    weight: number | null;
  }[];
}

export default function PlanCard({ log }: { log: TrainingLog }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium">{log.date}</span>
        {log.total_volume && (
          <span className="text-xs text-zinc-400">
            总容量 {log.total_volume.toFixed(0)} kg
          </span>
        )}
        {log.rpe && (
          <span className="text-xs text-zinc-400">RPE {log.rpe}</span>
        )}
        {log.duration && (
          <span className="text-xs text-zinc-400">{log.duration} min</span>
        )}
      </div>
      <div className="space-y-1">
        {log.exercises.map((ex, i) => (
          <div key={i} className="text-sm text-zinc-300">
            <span className="text-zinc-500 text-xs mr-2">[{ex.muscle_group}]</span>
            {ex.exercise_name}
            {ex.sets && ex.reps && ex.weight && (
              <span className="text-zinc-500 ml-2">
                {ex.sets}x{ex.reps} @{ex.weight}kg
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the dashboard page**

Replace `src/app/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import TrendChart from "@/components/TrendChart";
import RecoveryPanel from "@/components/RecoveryPanel";
import PlanCard from "@/components/PlanCard";

interface DashboardData {
  healthMetrics: Record<string, unknown>[];
  muscleRecovery: { muscle_group: string; last_trained: string; days_since: number; total_volume_7d: number | null }[];
  recentTrainings: Record<string, unknown>[];
  bodyComposition: Record<string, unknown>[];
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) {
    return <div className="text-zinc-500">加载中...</div>;
  }

  const healthData = data.healthMetrics.map((m) => ({
    date: (m.date as string).slice(5),
    hrv: m.hrv as number | null,
    resting_hr: m.resting_hr as number | null,
    sleep_hours: m.sleep_hours as number | null,
  }));

  return (
    <div className="space-y-6 max-w-5xl">
      <h2 className="text-xl font-bold">训练总览</h2>

      <div className="grid grid-cols-2 gap-4">
        <TrendChart
          title="HRV 趋势"
          data={healthData}
          series={[{ dataKey: "hrv", color: "#22c55e", name: "HRV (ms)" }]}
        />
        <TrendChart
          title="静息心率"
          data={healthData}
          series={[{ dataKey: "resting_hr", color: "#ef4444", name: "心率 (bpm)" }]}
        />
        <TrendChart
          title="睡眠时长"
          data={healthData}
          series={[{ dataKey: "sleep_hours", color: "#8b5cf6", name: "时长 (h)" }]}
        />
        <TrendChart
          title="体重 / 体脂"
          data={data.bodyComposition.map((m) => ({
            date: (m.date as string).slice(5),
            weight: m.weight as number | null,
            body_fat: m.body_fat as number | null,
          }))}
          series={[
            { dataKey: "weight", color: "#f59e0b", name: "体重 (kg)" },
            { dataKey: "body_fat", color: "#06b6d4", name: "体脂 (%)" },
          ]}
        />
      </div>

      <RecoveryPanel data={data.muscleRecovery} />

      <div>
        <h3 className="text-sm font-medium text-zinc-400 mb-3">近期训练</h3>
        <div className="space-y-2">
          {data.recentTrainings.map((log) => (
            <PlanCard key={log.id as number} log={log as Parameters<typeof PlanCard>[0]["log"]} />
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx src/components/PlanCard.tsx
git commit -m "feat: dashboard page with charts, recovery panel, and recent trainings"
```

---

### Task 12: LLM Client

**Files:**
- Create: `src/lib/llm.ts`

- [ ] **Step 1: Create the LLM client wrapper**

Create `src/lib/llm.ts`:

```ts
import { createOpenAI } from "@ai-sdk/openai";

export function getLLM() {
  return createOpenAI({
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    apiKey: process.env.DEEPSEEK_API_KEY,
  });
}

export function getModel() {
  const llm = getLLM();
  return llm("deepseek-chat");
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/llm.ts
git commit -m "feat: LLM client wrapper using Vercel AI SDK"
```

---

### Task 13: Agent Logic

**Files:**
- Create: `src/lib/agent.ts`

- [ ] **Step 1: Create the agent module with tools and system prompt**

Create `src/lib/agent.ts`:

```ts
import { generateText, tool } from "ai";
import { z } from "zod";
import { getModel } from "./llm";
import {
  queryHealthMetrics,
  queryTrainingHistoryDetailed,
  queryMuscleRecovery,
  queryBodyComposition,
  saveTrainingPlan,
} from "./db";

const SYSTEM_PROMPT = `你是一位专业的力量训练教练和运动科学顾问。

你的任务是根据用户的健康数据和训练历史，生成下一次训练计划。

## 核心原则

1. **渐进超负荷**：训练量应随时间逐步增加，但不盲目加量
2. **肌群恢复**：力量训练后肌群需要 48-72 小时恢复，间隔不足则跳过该肌群
3. **HRV 信号**：HRV 较 baseline 显著下降（>10%）提示身体压力较大，应降低训练强度
4. **静息心率**：静息心率较 baseline 升高 5bpm 以上提示恢复不足
5. **睡眠**：睡眠不足（<6h）或质量差时避免大重量训练
6. **RPE**：主观疲劳感高（>7）时，选择恢复性训练或休息

## 工作流程

1. 先查询用户的健康指标，评估身体状态
2. 查询各肌群恢复状态，确定哪些肌群可以训练
3. 查询近期训练历史，了解训练模式和进步趋势
4. 综合分析后生成训练计划

## 输出要求

生成训练计划时请提供：
- analysis_summary：综合分析（2-3句话，身体状态 + 恢复评估）
- recovery_assessment：恢复状态评估（哪些肌群可以训练，哪些需要继续休息）
- exercises：动作列表（JSON 数组，每项包含 name、muscle_group、sets、reps、weight）
- advice：注意事项和建议

请使用中文回复。`;

const agentTools = {
  query_health_metrics: tool({
    description: "查询最近 N 天的健康指标数据（HRV、静息心率、血压、睡眠等）",
    parameters: z.object({ days: z.number().default(7).describe("查询天数") }),
    execute: async ({ days }) => queryHealthMetrics(days),
  }),
  query_training_history: tool({
    description: "查询最近 N 天的训练历史记录",
    parameters: z.object({ days: z.number().default(14).describe("查询天数") }),
    execute: async ({ days }) => queryTrainingHistoryDetailed(days),
  }),
  query_muscle_recovery: tool({
    description: "查询各肌群的恢复状态（上次训练时间、距今天数、7天内累计容量）",
    parameters: z.object({}),
    execute: async () => queryMuscleRecovery(),
  }),
  query_body_composition: tool({
    description: "查询体重和体脂变化趋势",
    parameters: z.object({ days: z.number().default(30).describe("查询天数") }),
    execute: async ({ days }) => queryBodyComposition(days),
  }),
  save_training_plan: tool({
    description: "保存生成的训练计划到数据库",
    parameters: z.object({
      date: z.string().describe("生成日期 YYYY-MM-DD"),
      plan_date: z.string().optional().describe("计划目标日期"),
      analysis_summary: z.string().describe("综合分析"),
      recovery_assessment: z.string().describe("恢复状态评估"),
      exercises: z.string().describe("动作列表 JSON 字符串"),
      advice: z.string().describe("注意事项"),
    }),
    execute: async (params) => {
      saveTrainingPlan(params);
      return { ok: true };
    },
  }),
};

export async function runAgent() {
  const model = getModel();
  const result = await generateText({
    model,
    system: SYSTEM_PROMPT,
    prompt: `今天是 ${new Date().toISOString().split("T")[0]}，请根据我的数据生成下一次训练计划。`,
    tools: agentTools,
    maxSteps: 8,
  });

  return result;
}
```

- [ ] **Step 2: Install zod dependency**

```bash
npm install zod
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/agent.ts package.json package-lock.json
git commit -m "feat: agent logic with function calling tools and system prompt"
```

---

### Task 14: Agent API Route (SSE)

**Files:**
- Create: `src/app/api/agent/route.ts`

- [ ] **Step 1: Create the agent SSE endpoint**

Create `src/app/api/agent/route.ts`:

```ts
import { streamText } from "ai";
import { getModel } from "@/lib/llm";
import {
  queryHealthMetrics,
  queryTrainingHistoryDetailed,
  queryMuscleRecovery,
  queryBodyComposition,
  saveTrainingPlan,
} from "@/lib/db";
import { tool } from "ai";
import { z } from "zod";

const SYSTEM_PROMPT = `你是一位专业的力量训练教练和运动科学顾问。

你的任务是根据用户的健康数据和训练历史，生成下一次训练计划。

## 核心原则

1. **渐进超负荷**：训练量应随时间逐步增加，但不盲目加量
2. **肌群恢复**：力量训练后肌群需要 48-72 小时恢复，间隔不足则跳过该肌群
3. **HRV 信号**：HRV 较 baseline 显著下降（>10%）提示身体压力较大，应降低训练强度
4. **静息心率**：静息心率较 baseline 升高 5bpm 以上提示恢复不足
5. **睡眠**：睡眠不足（<6h）或质量差时避免大重量训练
6. **RPE**：主观疲劳感高（>7）时，选择恢复性训练或休息

## 工作流程

1. 先查询用户的健康指标，评估身体状态
2. 查询各肌群恢复状态，确定哪些肌群可以训练
3. 查询近期训练历史，了解训练模式和进步趋势
4. 综合分析后生成训练计划

## 输出要求

生成训练计划后请调用 save_training_plan 工具保存。请使用中文回复。`;

const agentTools = {
  query_health_metrics: tool({
    description: "查询最近 N 天的健康指标数据",
    parameters: z.object({ days: z.number().default(7) }),
    execute: async ({ days }) => queryHealthMetrics(days),
  }),
  query_training_history: tool({
    description: "查询最近 N 天的训练历史",
    parameters: z.object({ days: z.number().default(14) }),
    execute: async ({ days }) => queryTrainingHistoryDetailed(days),
  }),
  query_muscle_recovery: tool({
    description: "查询各肌群恢复状态",
    parameters: z.object({}),
    execute: async () => queryMuscleRecovery(),
  }),
  query_body_composition: tool({
    description: "查询体重体脂趋势",
    parameters: z.object({ days: z.number().default(30) }),
    execute: async ({ days }) => queryBodyComposition(days),
  }),
  save_training_plan: tool({
    description: "保存生成的训练计划",
    parameters: z.object({
      date: z.string(),
      plan_date: z.string().optional(),
      analysis_summary: z.string(),
      recovery_assessment: z.string(),
      exercises: z.string().describe("JSON 数组字符串"),
      advice: z.string(),
    }),
    execute: async (params) => {
      saveTrainingPlan(params);
      return { ok: true };
    },
  }),
};

export async function POST() {
  const model = getModel();
  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    prompt: `今天是 ${new Date().toISOString().split("T")[0]}，请根据我的数据生成下一次训练计划。`,
    tools: agentTools,
    maxSteps: 8,
  });

  return result.toDataStreamResponse();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/agent/route.ts
git commit -m "feat: agent API route with SSE streaming via Vercel AI SDK"
```

---

### Task 15: Plan Page

**Files:**
- Create: `src/app/plan/page.tsx`

- [ ] **Step 1: Create the plan page**

Create `src/app/plan/page.tsx`:

```tsx
"use client";

import { useState, useEffect, useRef } from "react";

interface Plan {
  id: number;
  date: string;
  plan_date: string | null;
  analysis_summary: string;
  recovery_assessment: string;
  exercises: string;
  advice: string;
  created_at: string;
}

export default function PlanPage() {
  const [generating, setGenerating] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [plans, setPlans] = useState<Plan[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetchPlans();
  }, []);

  const fetchPlans = async () => {
    const res = await fetch("/api/plans");
    if (res.ok) {
      const data = await res.json();
      setPlans(data.plans);
    }
  };

  const generate = async () => {
    setGenerating(true);
    setStreamText("");
    abortRef.current = new AbortController();

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        signal: abortRef.current.signal,
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) return;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setStreamText((prev) => prev + chunk);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setStreamText("生成失败，请检查 API Key 配置");
      }
    } finally {
      setGenerating(false);
      fetchPlans();
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center gap-4">
        <h2 className="text-xl font-bold">训练计划</h2>
        <button
          onClick={generate}
          disabled={generating}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-2 rounded text-sm font-medium"
        >
          {generating ? "分析中..." : "生成训练计划"}
        </button>
        {generating && (
          <button
            onClick={() => abortRef.current?.abort()}
            className="text-red-400 hover:text-red-300 text-sm"
          >
            取消
          </button>
        )}
      </div>

      {streamText && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-zinc-400 mb-2">Agent 分析过程</h3>
          <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-mono">
            {streamText}
          </pre>
        </div>
      )}

      <div>
        <h3 className="text-sm font-medium text-zinc-400 mb-3">历史计划</h3>
        {plans.length === 0 ? (
          <p className="text-zinc-600 text-sm">暂无训练计划</p>
        ) : (
          <div className="space-y-4">
            {plans.map((plan) => (
              <PlanHistoryCard key={plan.id} plan={plan} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PlanHistoryCard({ plan }: { plan: Plan }) {
  const [expanded, setExpanded] = useState(false);

  let exercises: { name: string; muscle_group: string; sets: number; reps: number; weight: number }[] = [];
  try {
    exercises = JSON.parse(plan.exercises || "[]");
  } catch {}

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div>
          <span className="font-medium">{plan.date}</span>
          {plan.plan_date && (
            <span className="text-zinc-500 text-sm ml-2">目标: {plan.plan_date}</span>
          )}
        </div>
        <span className="text-zinc-500 text-xs">
          {expanded ? "收起" : "展开"}
        </span>
      </div>
      {expanded && (
        <div className="mt-3 space-y-3">
          <div>
            <div className="text-xs text-zinc-500 mb-1">分析摘要</div>
            <div className="text-sm text-zinc-300">{plan.analysis_summary}</div>
          </div>
          <div>
            <div className="text-xs text-zinc-500 mb-1">恢复评估</div>
            <div className="text-sm text-zinc-300">{plan.recovery_assessment}</div>
          </div>
          {exercises.length > 0 && (
            <div>
              <div className="text-xs text-zinc-500 mb-1">训练动作</div>
              <div className="space-y-1">
                {exercises.map((ex, i) => (
                  <div key={i} className="text-sm text-zinc-300">
                    <span className="text-zinc-500 text-xs mr-2">[{ex.muscle_group}]</span>
                    {ex.name}
                    <span className="text-zinc-500 ml-2">
                      {ex.sets}x{ex.reps} @{ex.weight}kg
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {plan.advice && (
            <div>
              <div className="text-xs text-zinc-500 mb-1">建议</div>
              <div className="text-sm text-zinc-300">{plan.advice}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create plans API route for history**

Create `src/app/api/plans/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getTrainingPlans } from "@/lib/db";

export async function GET() {
  const plans = getTrainingPlans(20);
  return NextResponse.json({ plans });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/plan/page.tsx src/app/api/plans/route.ts
git commit -m "feat: plan page with agent generation and history display"
```

---

### Task 16: Integration Testing and Final Polish

**Files:**
- Modify: `src/app/plan/page.tsx` (fix SSE parsing)

- [ ] **Step 1: Fix SSE stream parsing in plan page**

The Vercel AI SDK `toDataStreamResponse()` sends data in a specific format. Update the stream reader in `src/app/plan/page.tsx` — replace the `generate` function's reader logic:

Replace the `generate` function in `src/app/plan/page.tsx`:

```tsx
  const generate = async () => {
    setGenerating(true);
    setStreamText("");
    abortRef.current = new AbortController();

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        signal: abortRef.current.signal,
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) return;

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("0:")) {
            const text = line.slice(2).replace(/^"(.*)"$/, "$1").replace(/\\n/g, "\n");
            setStreamText((prev) => prev + text);
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setStreamText("生成失败，请检查 API Key 配置");
      }
    } finally {
      setGenerating(false);
      fetchPlans();
    }
  };
```

- [ ] **Step 2: Start dev server and verify all pages load**

```bash
npm run dev
```

Open http://localhost:3000 and verify:
- Dashboard page loads (empty state)
- Navigate to /input — forms render
- Navigate to /plan — generate button visible

- [ ] **Step 3: Test data flow end-to-end**

1. Go to /input, fill in health data, save
2. Fill in training data with exercises, save
3. Go to / — verify charts show data
4. Go to /plan, click generate (requires valid DEEPSEEK_API_KEY in .env)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: fix SSE stream parsing and integration polish"
```
