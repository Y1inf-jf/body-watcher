"use client";

import { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { compute1RM, FORMULAS, LOW_ACCURACY_THRESHOLD, type FormulaKey } from "@/lib/formulas";

interface ProgressPoint {
  date: string;
  max_weight: number | null;
  max_weight_reps: number | null;
}

interface ExerciseSuggestion {
  exercise_name: string;
  muscle_group: string;
}

export default function ExerciseProgress() {
  const [exercises, setExercises] = useState<ExerciseSuggestion[]>([]);
  const [selected, setSelected] = useState("");
  const [progress, setProgress] = useState<ProgressPoint[]>([]);
  const [error, setError] = useState("");
  const [formula, setFormula] = useState<FormulaKey>("epley");

  useEffect(() => {
    fetch("/api/exercises")
      .then((r) => r.json())
      .then((d) => {
        const list = d.exercises || [];
        setExercises(list);
        if (list.length > 0) setSelected(list[0].exercise_name);
      })
      .catch(() => setError("加载动作列表失败"));
  }, []);

  useEffect(() => {
    if (!selected) return;
    fetch(`/api/exercises?progress=${encodeURIComponent(selected)}`)
      .then((r) => r.json())
      .then((d) => setProgress(d.progress || []))
      .catch(() => setError("加载进度数据失败"));
  }, [selected]);

  // 防御性排序：不依赖后端返回顺序，避免「最新点」与 x 轴语义出错
  // （与此前 HRV/HR/睡眠趋势图 x 轴反转同类的隐患）。
  const sortedProgress = [...progress].sort((a, b) => a.date.localeCompare(b.date));

  const latest = sortedProgress.length > 0 ? sortedProgress[sortedProgress.length - 1] : null;

  // 1RM 由前端按当前选定的公式本地重算，切换即时生效、无需重新请求。
  const latest1RM = latest ? compute1RM(latest.max_weight, latest.max_weight_reps, formula) : null;

  const chartData = sortedProgress.map((p) => ({
    date: p.date.slice(5),
    weight: p.max_weight,
    est_1rm: compute1RM(p.max_weight, p.max_weight_reps, formula),
  }));

  // 是否存在超过低准确度阈值的点，用于提示用户。
  const hasLowAccuracyPoints = sortedProgress.some(
    (p) => p.max_weight_reps != null && p.max_weight_reps > LOW_ACCURACY_THRESHOLD
  );

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h3 className="text-sm font-medium text-zinc-400">渐进超负荷追踪</h3>
        <div className="flex items-center gap-2">
          {exercises.length > 0 && (
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm"
            >
              {exercises.map((e) => (
                <option key={e.exercise_name} value={e.exercise_name}>
                  {e.exercise_name}
                </option>
              ))}
            </select>
          )}
          <select
            value={formula}
            onChange={(e) => setFormula(e.target.value as FormulaKey)}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm"
            title="1RM 估算公式"
          >
            {(Object.keys(FORMULAS) as FormulaKey[]).map((k) => (
              <option key={k} value={k}>
                {FORMULAS[k].label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <p className="text-red-400 text-sm">{error}</p>
      ) : exercises.length === 0 || progress.length === 0 ? (
        <p className="text-zinc-600 text-sm">暂无数据</p>
      ) : (
        <>
          <div className="flex gap-4 mb-3">
            {latest?.max_weight != null && (
              <div>
                <span className="text-xs text-zinc-500">最重</span>
                <span className="text-lg font-bold text-zinc-200 ml-1">
                  {latest.max_weight}kg
                </span>
                <span className="text-xs text-zinc-500 ml-1">×{latest.max_weight_reps}</span>
              </div>
            )}
            {latest1RM != null && (
              <div>
                <span className="text-xs text-zinc-500">估算 1RM ({FORMULAS[formula].label})</span>
                <span className="text-lg font-bold text-amber-400 ml-1">
                  {Math.round(latest1RM)}kg
                </span>
              </div>
            )}
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
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
              <Line
                type="monotone"
                dataKey="weight"
                stroke="#22c55e"
                name="最重重量 (kg)"
                strokeWidth={2}
                dot={{ r: 3, fill: "#22c55e" }}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="est_1rm"
                stroke="#f59e0b"
                name={`估算 1RM ${FORMULAS[formula].label} (kg)`}
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
          {hasLowAccuracyPoints && (
            <p className="text-xs text-zinc-500 mt-2">
              * 含超过 {LOW_ACCURACY_THRESHOLD} 次的记录，1RM 估算准确度下降
            </p>
          )}
        </>
      )}
    </div>
  );
}
