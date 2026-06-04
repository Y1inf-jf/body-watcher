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
