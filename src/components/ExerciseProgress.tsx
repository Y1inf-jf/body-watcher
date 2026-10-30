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
import Stat from "./ui/Stat";
import { CHART } from "./ui/chart-theme";
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
    <div className="animate-fade-up">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 className="text-sm font-medium text-ink">渐进超负荷追踪</h3>
        <div className="flex flex-wrap items-center gap-2">
          {exercises.length > 0 && (
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="field py-1.5"
              aria-label="选择动作"
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
            className="field py-1.5"
            title="1RM 估算公式"
            aria-label="1RM 估算公式"
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
        <p className="text-sm text-zone-red">{error}</p>
      ) : exercises.length === 0 || progress.length === 0 ? (
        <p className="text-sm text-ink-3">暂无数据</p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-x-8 gap-y-3">
            {latest?.max_weight != null && (
              <Stat
                label="最重"
                value={latest.max_weight}
                unit={`kg ×${latest.max_weight_reps}`}
              />
            )}
            {latest1RM != null && (
              <Stat
                label={`估算 1RM (${FORMULAS[formula].label})`}
                value={Math.round(latest1RM)}
                unit="kg"
              />
            )}
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="date" tick={CHART.tick} minTickGap={24} axisLine={false} tickLine={false} />
              <YAxis tick={CHART.tick} width={32} axisLine={false} tickLine={false} />
              <Tooltip {...CHART.tooltip} />
              <Line
                type="monotone"
                dataKey="weight"
                stroke={CHART.series.primary}
                name="最重重量 (kg)"
                strokeWidth={1.5}
                dot={{ r: 2.5, fill: CHART.series.primary, strokeWidth: 0 }}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="est_1rm"
                stroke={CHART.series.secondary}
                name={`估算 1RM ${FORMULAS[formula].label} (kg)`}
                strokeWidth={1.5}
                strokeDasharray="5 5"
                dot={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
          {hasLowAccuracyPoints && (
            <p className="mt-2 text-xs text-ink-3">
              * 含超过 {LOW_ACCURACY_THRESHOLD} 次的记录，1RM 估算准确度下降
            </p>
          )}
        </>
      )}
    </div>
  );
}
