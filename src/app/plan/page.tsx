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
            {plans.map((plan, i) => (
              <PlanHistoryCard key={plan.id} plan={plan} defaultExpanded={i === 0} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PlanHistoryCard({ plan, defaultExpanded = false }: { plan: Plan; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

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
          <div className="border-l-2 border-blue-500 pl-3">
            <div className="text-xs text-zinc-500 mb-1">分析摘要</div>
            <div className="text-sm text-zinc-300">{plan.analysis_summary}</div>
          </div>
          <div className="border-l-2 border-amber-500 pl-3">
            <div className="text-xs text-zinc-500 mb-1">恢复评估</div>
            <div className="text-sm text-zinc-300">{plan.recovery_assessment}</div>
          </div>
          {exercises.length > 0 && (
            <div>
              <div className="text-xs text-zinc-500 mb-2">训练动作</div>
              <div className="space-y-2">
                {exercises.map((ex, i) => (
                  <div key={i} className="bg-zinc-800/50 border border-zinc-700/50 rounded p-2">
                    <div className="text-sm text-zinc-200">
                      <span className="text-zinc-500 text-xs mr-2">[{ex.muscle_group}]</span>
                      <span className="font-medium">{ex.name}</span>
                      <span className="text-zinc-500 text-xs ml-2">{ex.sets}组</span>
                    </div>
                    <div className="text-xs text-zinc-400 ml-1 mt-0.5">
                      {ex.sets}组 × {ex.reps}次
                      {ex.weight ? ` @ ${ex.weight}kg` : " 自重"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {plan.advice && (
            <div className="border-l-2 border-green-500 pl-3">
              <div className="text-xs text-zinc-500 mb-1">建议</div>
              <div className="text-sm text-zinc-300">{plan.advice}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
