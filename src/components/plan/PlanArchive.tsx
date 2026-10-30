"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2 } from "lucide-react";
import Disclosure from "@/components/ui/Disclosure";
import Tag from "@/components/ui/Tag";

// 历史计划:保留执行闭环;含手动录入自己的训练计划的表单。
// 布局用容器查询(@md),跟随右栏/手机整宽自适应,而不是视口断点。
export default function PlanArchive() {
  const [
    plans,
    setPlans,
  ] = useState<
    {
      id: number;
      date: string;
      plan_date: string | null;
      analysis_summary: string;
      recovery_assessment: string;
      exercises: string;
      advice: string;
    }[]
  >([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // 手动录入自己的训练计划(动作行可增删),保存后走与 AI 计划相同的"执行"闭环。
  const [showForm, setShowForm] = useState(false);
  const [planDate, setPlanDate] = useState(new Date().toISOString().split("T")[0]);
  const [targetDate, setTargetDate] = useState("");
  const [rows, setRows] = useState([
    { name: "", muscle_group: "", sets: "", reps: "", weight: "" },
  ]);
  const [advice, setAdvice] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(() => {
    fetch("/api/plans")
      .then((r) => r.json())
      .then((d) => setPlans(d.plans ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setPlanDate(new Date().toISOString().split("T")[0]);
    setTargetDate("");
    setRows([{ name: "", muscle_group: "", sets: "", reps: "", weight: "" }]);
    setAdvice("");
    setFormError("");
  };

  const savePlan = async () => {
    setFormError("");
    const exercises = rows
      .map((r) => ({
        name: r.name.trim(),
        muscle_group: r.muscle_group.trim(),
        sets: r.sets ? parseInt(r.sets) : NaN,
        reps: r.reps ? parseInt(r.reps) : NaN,
        weight: r.weight ? parseFloat(r.weight) : null,
      }))
      .filter((r) => r.name || r.muscle_group);
    if (exercises.length === 0) {
      setFormError("至少填一个动作");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: planDate,
          ...(targetDate ? { plan_date: targetDate } : {}),
          exercises,
          advice: advice || undefined,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFormError(json.error ?? "保存失败");
        return;
      }
      resetForm();
      setShowForm(false);
      load();
    } catch {
      setFormError("网络错误,未保存");
    } finally {
      setSaving(false);
    }
  };

  const removePlan = async (id: number) => {
    if (!window.confirm("删除这条历史计划?不可恢复。")) return;
    setDeletingId(id);
    try {
      await fetch(`/api/plans?id=${id}`, { method: "DELETE" });
      setPlans((prev) => prev.filter((p) => p.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="@container space-y-3">
      {/* 工具栏始终显示:无计划时也能新建;手动录入的计划与 AI 计划同列表、同执行闭环 */}
      <div className="flex items-center justify-between py-3">
        <span className="text-xs text-ink-3">历史计划</span>
        <button onClick={() => setShowForm((v) => !v)} className="btn btn-secondary btn-sm">
          {showForm ? "收起表单" : "新建计划"}
        </button>
      </div>

      {plans.length === 0 && !showForm && <p className="text-sm text-ink-3">暂无训练计划</p>}

      {showForm && (
        <div className="rounded-md border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <label className="flex items-center gap-1.5 text-ink-2">
              计划日期
              <input
                type="date"
                value={planDate}
                onChange={(e) => setPlanDate(e.target.value)}
                className="field py-1"
              />
            </label>
            <label className="flex items-center gap-1.5 text-ink-2">
              目标日期(可选)
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="field py-1"
              />
            </label>
          </div>

          <div className="mt-3 space-y-2">
            <div className="hidden gap-1.5 text-xs text-ink-3 @md:flex">
              <span className="min-w-0 flex-1">动作</span>
              <span className="w-16 shrink-0">肌群</span>
              <span className="w-12 shrink-0">组</span>
              <span className="w-12 shrink-0">次</span>
              <span className="w-16 shrink-0">kg</span>
              <span className="w-5 shrink-0" />
            </div>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_2rem] gap-1.5 @md:flex">
                <input
                  value={r.name}
                  onChange={(e) =>
                    setRows((rs) => rs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                  }
                  aria-label="动作"
                  placeholder="如 杠铃卧推"
                  className="field col-span-full min-w-0 px-2 py-1.5 @md:flex-1"
                />
                <input
                  value={r.muscle_group}
                  onChange={(e) =>
                    setRows((rs) => rs.map((x, j) => (j === i ? { ...x, muscle_group: e.target.value } : x)))
                  }
                  aria-label="肌群"
                  placeholder="胸"
                  className="field min-w-0 px-2 py-1.5 @md:w-16 @md:shrink-0"
                />
                <input
                  value={r.sets}
                  onChange={(e) =>
                    setRows((rs) => rs.map((x, j) => (j === i ? { ...x, sets: e.target.value } : x)))
                  }
                  inputMode="numeric"
                  aria-label="组"
                  placeholder="4"
                  className="field min-w-0 px-2 py-1.5 text-center @md:w-12 @md:shrink-0"
                />
                <input
                  value={r.reps}
                  onChange={(e) =>
                    setRows((rs) => rs.map((x, j) => (j === i ? { ...x, reps: e.target.value } : x)))
                  }
                  inputMode="numeric"
                  aria-label="次"
                  placeholder="8"
                  className="field min-w-0 px-2 py-1.5 text-center @md:w-12 @md:shrink-0"
                />
                <input
                  value={r.weight}
                  onChange={(e) =>
                    setRows((rs) => rs.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))
                  }
                  inputMode="decimal"
                  aria-label="kg"
                  placeholder="自重"
                  className="field min-w-0 px-2 py-1.5 text-center @md:w-16 @md:shrink-0"
                />
                <button
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                  className="grid w-8 shrink-0 place-items-center text-ink-3 transition-colors hover:text-zone-red @md:w-5"
                  aria-label="移除该动作"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              onClick={() => setRows((rs) => [...rs, { name: "", muscle_group: "", sets: "", reps: "", weight: "" }])}
              className="btn btn-ghost btn-sm"
            >
              <Plus size={12} /> 添加动作
            </button>
          </div>

          <textarea
            value={advice}
            onChange={(e) => setAdvice(e.target.value)}
            placeholder="注意事项(可选),如:组间休息 90 秒,最后一路做到力竭"
            rows={2}
            className="field mt-3 w-full"
          />

          {formError && <p className="mt-2 text-xs text-zone-red">{formError}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button onClick={savePlan} disabled={saving} className="btn btn-primary btn-sm">
              {saving ? "保存中..." : "保存计划"}
            </button>
            <span className="text-[11px] text-ink-3">保存后出现在列表里,可点「执行」带入训记,自动闭环</span>
          </div>
        </div>
      )}

      <div className="divide-y divide-line">
        {plans.map((plan) => {
          let exercises: { name: string; muscle_group: string; sets: number; reps: number; weight: number }[] = [];
          try {
            exercises = JSON.parse(plan.exercises || "[]");
          } catch {}
          const execPlanHref = `/input?plan=${encodeURIComponent(plan.exercises || "[]")}&planId=${plan.id}`;
          return (
            <Disclosure
              key={plan.id}
              summary={
                <span className="font-medium">
                  {plan.date}
                  {plan.plan_date && <span className="ml-2 text-xs font-normal text-ink-3">目标: {plan.plan_date}</span>}
                  {!plan.recovery_assessment && !plan.analysis_summary && (
                    <span className="ml-2 align-middle">
                      <Tag>自建</Tag>
                    </span>
                  )}
                </span>
              }
              meta={`${exercises.length} 个动作`}
              actions={
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removePlan(plan.id);
                  }}
                  disabled={deletingId === plan.id}
                  className="grid h-8 w-8 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-zone-red disabled:opacity-40"
                  aria-label="删除该计划"
                  title="删除该计划"
                >
                  <Trash2 size={14} />
                </button>
              }
            >
              <div className="space-y-3">
                {plan.analysis_summary && (
                  <div className="border-l-2 border-line-strong pl-3">
                    <div className="mb-1 text-xs text-ink-3">分析摘要</div>
                    <div className="text-sm text-ink-2">{plan.analysis_summary}</div>
                  </div>
                )}
                {plan.recovery_assessment && (
                  <div className="border-l-2 border-line-strong pl-3">
                    <div className="mb-1 text-xs text-ink-3">恢复评估</div>
                    <div className="text-sm text-ink-2">{plan.recovery_assessment}</div>
                  </div>
                )}
                {exercises.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-xs text-ink-3">训练动作</div>
                      <a href={execPlanHref} className="btn btn-secondary btn-sm">
                        执行
                      </a>
                    </div>
                    <div className="space-y-2">
                      {exercises.map((ex, i) => (
                        <div key={i}>
                          <div className="text-sm text-ink">
                            <span className="mr-2 text-xs text-ink-3">[{ex.muscle_group}]</span>
                            <span className="font-medium">{ex.name}</span>
                            <span className="ml-2 text-xs text-ink-3">{ex.sets}组</span>
                          </div>
                          <div className="mt-0.5 font-mono text-xs text-ink-2">
                            {ex.sets}组 × {ex.reps}次
                            {ex.weight ? ` @ ${ex.weight}kg` : " 自重"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {plan.advice && (
                  <div className="border-l-2 border-line-strong pl-3">
                    <div className="mb-1 text-xs text-ink-3">建议</div>
                    <div className="text-sm text-ink-2">{plan.advice}</div>
                  </div>
                )}
              </div>
            </Disclosure>
          );
        })}
      </div>
    </div>
  );
}
