"use client";

import { useState, useEffect, useRef } from "react";

interface SetData {
  reps: string;
  weight: string;
  bodyweight: boolean;
  rpe: string;
}

interface ExerciseBlock {
  exercise_name: string;
  muscle_group: string;
  sets: SetData[];
}

interface ExerciseSuggestion {
  exercise_name: string;
  muscle_group: string;
  source?: "history" | "library";
  equipment?: string | null;
}

interface LastSet {
  reps: number | null;
  weight: number | null;
  bodyweight: number | null;
  rpe: number | null;
}

interface TemplateExercise {
  name?: string;
  exercise_name?: string;
  muscle_group: string;
  sets?: number;
  reps?: number;
  weight?: number;
}

const MUSCLE_GROUPS = ["胸", "背", "股四头肌", "腘绳肌", "三头", "二头", "前束", "中束", "后束", "臀", "核心"];

// wger 英文肌群/分类 → 中文，用于从动作库选中时自动映射。
// 覆盖 wger 的 muscle name_en 与 exercisecategory name 两套取值。
const WGER_GROUP_MAP: Record<string, string> = {
  // 肌群 (muscle.name_en)
  Chest: "胸",
  Biceps: "二头",
  Triceps: "三头",
  Shoulders: "中束",
  Lats: "背",
  Glutes: "臀",
  Hamstrings: "腘绳肌",
  Quads: "股四头肌",
  Calves: "核心", // 中文肌群列表无小腿，暂归核心（可按需调整）
  Abs: "核心",
  // 分类 (exercisecategory.name) —— 当动作无具体肌群时回退用
  Back: "背",
  Arms: "二头",
  Legs: "股四头肌",
  Cardio: "核心",
};

const defaultSet = (): SetData => ({ reps: "", weight: "", bodyweight: false, rpe: "" });

const defaultBlock = (): ExerciseBlock => ({
  exercise_name: "",
  muscle_group: "胸",
  sets: [defaultSet()],
});

// 纯函数：把扁平的训练动作行按 exercise_name 连续分组为表单 block。
// 放在模块级，使 effect 中引用它时不触发 react-hooks/immutability 规则。
function groupExercisesFromDB(exercises: Record<string, unknown>[]): ExerciseBlock[] {
  const result: ExerciseBlock[] = [];
  for (const ex of exercises) {
    const name = ex.exercise_name as string;
    const last = result[result.length - 1];
    if (last && last.exercise_name === name) {
      last.sets.push({
        reps: ex.reps != null ? String(ex.reps) : "",
        weight: ex.bodyweight ? "" : (ex.weight != null ? String(ex.weight) : ""),
        bodyweight: !!ex.bodyweight,
        rpe: ex.rpe != null ? String(ex.rpe) : "",
      });
    } else {
      result.push({
        exercise_name: name,
        muscle_group: ex.muscle_group as string,
        sets: [{
          reps: ex.reps != null ? String(ex.reps) : "",
          weight: ex.bodyweight ? "" : (ex.weight != null ? String(ex.weight) : ""),
          bodyweight: !!ex.bodyweight,
          rpe: ex.rpe != null ? String(ex.rpe) : "",
        }],
      });
    }
  }
  return result;
}

interface TrainingFormProps {
  editId?: number | null;
  initialDate?: string;
  templateData?: string | null;
  templateKey?: number;
}

export default function TrainingForm({ editId, initialDate, templateData, templateKey }: TrainingFormProps) {
  const [date, setDate] = useState(initialDate || new Date().toISOString().split("T")[0]);
  const [duration, setDuration] = useState("");
  const [rpe, setRpe] = useState("");
  const [notes, setNotes] = useState("");
  const [blocks, setBlocks] = useState<ExerciseBlock[]>([defaultBlock()]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [exerciseNames, setExerciseNames] = useState<ExerciseSuggestion[]>([]);
  const [libraryResults, setLibraryResults] = useState<ExerciseSuggestion[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState<number | null>(null);
  const suggestionRef = useRef<HTMLDivElement>(null);
  const [templates, setTemplates] = useState<{ id: number; name: string; exercises: string }[]>([]);

  useEffect(() => {
    fetch("/api/exercises")
      .then((r) => r.json())
      .then((d) => setExerciseNames(d.exercises || []))
      .catch(() => {});
    fetch("/api/templates")
      .then((r) => r.json())
      .then((d) => setTemplates(d.templates || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (suggestionRef.current && !suggestionRef.current.contains(e.target as Node)) {
        setActiveSuggestion(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 当某个动作输入框激活时，防抖搜索本地 wger 动作库，补充历史记录之外的候选。
  // effect 主体只调度定时器；清空与请求都在异步回调里，避免 set-state-in-effect。
  const activeQuery = activeSuggestion != null ? blocks[activeSuggestion]?.exercise_name ?? "" : "";
  useEffect(() => {
    const q = activeQuery.trim();
    const timer = setTimeout(() => {
      if (!q || q.length < 2) {
        setLibraryResults([]);
        return;
      }
      fetch(`/api/exercises?search=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => {
          const results: ExerciseSuggestion[] = (d.results || []).map(
            (r: { name: string; muscle_group?: string | null; equipment?: string | null }) => ({
              exercise_name: r.name,
              muscle_group: r.muscle_group || "",
              source: "library" as const,
              equipment: r.equipment,
            })
          );
          setLibraryResults(results);
        })
        .catch(() => setLibraryResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [activeQuery]);

  // Load edit data
  useEffect(() => {
    if (!editId) return;
    fetch(`/api/training?edit=${editId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.log) return;
        const l = d.log as Record<string, unknown>;
        setDate(l.date as string);
        setDuration(l.duration ? String(l.duration) : "");
        setRpe(l.rpe ? String(l.rpe) : "");
        setNotes((l.notes as string) || "");
        const exs = (l.exercises || []) as Record<string, unknown>[];
        const grouped = groupExercisesFromDB(exs);
        if (grouped.length > 0) setBlocks(grouped);
      })
      .catch(() => {});
  }, [editId]);

  // Load template data
  // 解析模板并填充表单。setState 放在异步 IIFE 中，避免 react-hooks/set-state-in-effect。
  useEffect(() => {
    if (!templateData || templateKey === 0) return;
    void (async () => {
      try {
        const parsed = JSON.parse(templateData) as TemplateExercise[];
        if (parsed.length === 0) return;
        const newBlocks: ExerciseBlock[] = [];
        for (const ex of parsed) {
          const name = ex.name || ex.exercise_name || "";
          if (!name) continue;
          const block: ExerciseBlock = {
            exercise_name: name,
            muscle_group: ex.muscle_group || "胸",
            sets: [],
          };
          const numSets = ex.sets || 1;
          for (let s = 0; s < numSets; s++) {
            block.sets.push({
              reps: ex.reps ? String(ex.reps) : "",
              weight: ex.weight ? String(ex.weight) : "",
              bodyweight: false,
              rpe: "",
            });
          }
          if (block.sets.length === 0) block.sets.push(defaultSet());
          newBlocks.push(block);
        }
        if (newBlocks.length > 0) setBlocks(newBlocks);
      } catch {}
    })();
  }, [templateData, templateKey]);

  const updateBlock = (bi: number, field: "exercise_name" | "muscle_group", value: string) => {
    setBlocks((prev) => {
      const next = [...prev];
      next[bi] = { ...next[bi], [field]: value };
      return next;
    });
  };

  const updateSet = (bi: number, si: number, field: keyof SetData, value: string | boolean) => {
    setBlocks((prev) => {
      const next = [...prev];
      const sets = [...next[bi].sets];
      sets[si] = { ...sets[si], [field]: value };
      if (field === "bodyweight" && value === true) {
        sets[si].weight = "";
      }
      next[bi] = { ...next[bi], sets };
      return next;
    });
  };

  const addSet = (bi: number) => {
    setBlocks((prev) => {
      const next = [...prev];
      const lastSet = next[bi].sets[next[bi].sets.length - 1];
      next[bi] = { ...next[bi], sets: [...next[bi].sets, { ...lastSet }] };
      return next;
    });
  };

  const removeSet = (bi: number, si: number) => {
    setBlocks((prev) => {
      const next = [...prev];
      next[bi] = { ...next[bi], sets: next[bi].sets.filter((_, i) => i !== si) };
      return next;
    });
  };

  const addBlock = () => {
    setBlocks((prev) => [...prev, defaultBlock()]);
  };

  const removeBlock = (bi: number) => {
    setBlocks((prev) => prev.filter((_, i) => i !== bi));
  };

  const selectExercise = async (bi: number, suggestion: ExerciseSuggestion) => {
    updateBlock(bi, "exercise_name", suggestion.exercise_name);
    // wger 库返回英文肌群，需映射到中文下拉值；本地历史已是中文直接用。
    const group =
      suggestion.source === "library"
        ? WGER_GROUP_MAP[suggestion.muscle_group] || "胸"
        : suggestion.muscle_group;
    updateBlock(bi, "muscle_group", group);
    setActiveSuggestion(null);

    try {
      const res = await fetch(`/api/exercises?last=${encodeURIComponent(suggestion.exercise_name)}`);
      const data = await res.json();
      if (data.sets?.length) {
        setBlocks((prev) => {
          const next = [...prev];
          const newSets: SetData[] = data.sets.map((s: LastSet) => ({
            reps: s.reps != null ? String(s.reps) : "",
            weight: s.bodyweight ? "" : (s.weight != null ? String(s.weight) : ""),
            bodyweight: !!s.bodyweight,
            rpe: s.rpe != null ? String(s.rpe) : "",
          }));
          next[bi] = { ...next[bi], sets: newSets };
          return next;
        });
      }
    } catch {}
  };

  const getFilteredSuggestions = (query: string): ExerciseSuggestion[] => {
    if (!query) return [];
    const q = query.toLowerCase();
    // 本地历史匹配优先。
    const local = exerciseNames
      .filter((e) => e.exercise_name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((e) => ({ ...e, source: "history" as const }));
    // wger 库匹配补充（已练过的动作名去重）。
    const localNames = new Set(local.map((e) => e.exercise_name.toLowerCase()));
    const fromLibrary = libraryResults
      .filter((e) => e.exercise_name.toLowerCase().includes(q) && !localNames.has(e.exercise_name.toLowerCase()))
      .slice(0, 8 - local.length);
    return [...local, ...fromLibrary];
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    const exercises = blocks.flatMap((b) =>
      b.sets.map((s) => ({
        exercise_name: b.exercise_name,
        muscle_group: b.muscle_group,
        sets: 1 as const,
        reps: s.reps ? parseInt(s.reps) : null,
        weight: s.bodyweight ? null : (s.weight ? parseFloat(s.weight) : null),
        bodyweight: s.bodyweight ? 1 : 0,
        rpe: s.rpe ? parseInt(s.rpe) : null,
      }))
    );

    const body = {
      ...(editId ? { id: editId } : {}),
      date,
      duration: duration ? parseInt(duration) : null,
      rpe: rpe ? parseInt(rpe) : null,
      notes: notes || null,
      exercises,
    };

    const res = await fetch("/api/training", {
      method: editId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setSaving(false);
    if (res.ok) {
      if (editId) {
        window.location.href = "/";
      } else {
        setMessage("已保存");
        setBlocks([defaultBlock()]);
        setDuration("");
        setRpe("");
        setNotes("");
        setTimeout(() => setMessage(""), 2000);
      }
    } else {
      setMessage("保存失败");
    }
  };

  const saveAsTemplate = async () => {
    const name = prompt("模板名称（如：推日、拉日、腿日）");
    if (!name) return;
    const exercises = blocks.map((b) => ({
      name: b.exercise_name,
      muscle_group: b.muscle_group,
      sets: b.sets.length,
      reps: b.sets[0].reps ? parseInt(b.sets[0].reps) : null,
      weight: b.sets[0].bodyweight ? null : (b.sets[0].weight ? parseFloat(b.sets[0].weight) : null),
    }));
    await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, exercises }),
    });
    const res = await fetch("/api/templates");
    const d = await res.json();
    setTemplates(d.templates || []);
  };

  const loadTemplate = (t: { exercises: string }) => {
    try {
      const parsed = JSON.parse(t.exercises) as TemplateExercise[];
      if (parsed.length === 0) return;
      const newBlocks: ExerciseBlock[] = parsed.map((ex) => {
        const name = ex.name || ex.exercise_name || "";
        const numSets = ex.sets || 1;
        const sets: SetData[] = [];
        for (let s = 0; s < numSets; s++) {
          sets.push({
            reps: ex.reps ? String(ex.reps) : "",
            weight: ex.weight ? String(ex.weight) : "",
            bodyweight: false,
            rpe: "",
          });
        }
        return { exercise_name: name, muscle_group: ex.muscle_group || "胸", sets: sets.length ? sets : [defaultSet()] };
      });
      setBlocks(newBlocks);
    } catch {}
  };

  const deleteTemplate = async (id: number) => {
    const res = await fetch(`/api/templates?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setTemplates((prev) => prev.filter((t) => t.id !== id));
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
          placeholder="整体 RPE"
          value={rpe}
          onChange={(e) => setRpe(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm w-28"
        />
        <button
          type="submit"
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-1.5 rounded text-sm font-medium"
        >
          {saving ? "保存中..." : editId ? "更新训练" : "保存训练"}
        </button>
        {message && <span className="text-sm text-green-400">{message}</span>}
      </div>

      {templates.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-zinc-500">模板：</span>
          {templates.map((t) => (
            <span key={t.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => loadTemplate(t)}
                className="text-xs bg-zinc-800 text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded"
              >
                {t.name}
              </button>
              <button type="button" onClick={() => deleteTemplate(t.id)} className="text-zinc-600 hover:text-red-400 text-xs">x</button>
            </span>
          ))}
          <button type="button" onClick={saveAsTemplate} className="text-xs text-zinc-500 hover:text-zinc-300 ml-2">
            + 存为模板
          </button>
        </div>
      )}
      {templates.length === 0 && (
        <button type="button" onClick={saveAsTemplate} className="text-xs text-zinc-500 hover:text-zinc-300">
          保存当前训练为模板
        </button>
      )}

      <div className="space-y-3">
        {blocks.map((block, bi) => {
          const filtered = activeSuggestion === bi ? getFilteredSuggestions(block.exercise_name) : [];
          return (
            <div key={bi} className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="relative flex-1" ref={activeSuggestion === bi ? suggestionRef : undefined}>
                  <input
                    type="text"
                    placeholder="动作名称"
                    value={block.exercise_name}
                    onChange={(e) => {
                      updateBlock(bi, "exercise_name", e.target.value);
                      setActiveSuggestion(bi);
                    }}
                    onFocus={() => setActiveSuggestion(bi)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setActiveSuggestion(null);
                    }}
                    className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm w-full font-medium"
                  />
                  {filtered.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded shadow-lg z-10 max-h-60 overflow-y-auto">
                      {filtered.map((s) => (
                        <button
                          key={s.exercise_name + (s.source ?? "")}
                          type="button"
                          onClick={() => selectExercise(bi, s)}
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-700 flex items-center justify-between"
                        >
                          <span>{s.exercise_name}</span>
                          <span className="flex items-center gap-1">
                            {s.equipment && (
                              <span className="text-xs text-zinc-600">{s.equipment}</span>
                            )}
                            {s.source === "library" ? (
                              <span className="text-xs text-blue-400">[库]</span>
                            ) : s.muscle_group ? (
                              <span className="text-xs text-zinc-500">[{s.muscle_group}]</span>
                            ) : null}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <select
                  value={block.muscle_group}
                  onChange={(e) => updateBlock(bi, "muscle_group", e.target.value)}
                  className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm"
                >
                  {MUSCLE_GROUPS.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
                {blocks.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeBlock(bi)}
                    className="text-red-400 hover:text-red-300 text-sm px-2"
                  >
                    删除动作
                  </button>
                )}
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs text-zinc-500 px-1">
                  <span className="w-6 text-center">组</span>
                  <span className="w-12 text-center">次数</span>
                  <span className="w-20 text-center">重量</span>
                  <span className="w-12 text-center">RPE</span>
                  <span className="w-6" />
                </div>
                {block.sets.map((set, si) => (
                  <div key={si} className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500 w-6 text-center">{si + 1}</span>
                    <input
                      type="number"
                      placeholder="次"
                      value={set.reps}
                      onChange={(e) => updateSet(bi, si, "reps", e.target.value)}
                      className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm w-12 text-center"
                    />
                    <div className="flex items-center gap-1 w-20">
                      {set.bodyweight ? (
                        <span className="bg-zinc-700 border border-zinc-600 rounded px-2 py-1.5 text-sm w-full text-center text-zinc-300">
                          自重
                        </span>
                      ) : (
                        <input
                          type="number"
                          step="any"
                          placeholder="kg"
                          value={set.weight}
                          onChange={(e) => updateSet(bi, si, "weight", e.target.value)}
                          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm w-full text-center"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => updateSet(bi, si, "bodyweight", !set.bodyweight)}
                        className={`text-xs px-1 py-1.5 rounded ${
                          set.bodyweight
                            ? "bg-amber-700 text-amber-100"
                            : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                        }`}
                        title="切换自重"
                      >
                        BW
                      </button>
                    </div>
                    <input
                      type="number"
                      placeholder="RPE"
                      value={set.rpe}
                      onChange={(e) => updateSet(bi, si, "rpe", e.target.value)}
                      className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm w-12 text-center"
                    />
                    {block.sets.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeSet(bi, si)}
                        className="text-red-400 hover:text-red-300 text-sm w-6 text-center"
                      >
                        x
                      </button>
                    ) : (
                      <span className="w-6" />
                    )}
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => addSet(bi)}
                className="text-blue-400 hover:text-blue-300 text-xs mt-2"
              >
                + 添加一组
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addBlock}
        className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-4 py-1.5 rounded text-sm"
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
