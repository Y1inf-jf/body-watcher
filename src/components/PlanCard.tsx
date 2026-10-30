"use client";

import { useState } from "react";

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
    bodyweight: number | null;
    rpe: number | null;
  }[];
}

interface ExerciseBlock {
  name: string;
  muscle_group: string;
  sets: { reps: number | null; weight: number | null; bodyweight: number | null; rpe: number | null }[];
}

function groupExercises(exercises: TrainingLog["exercises"]): ExerciseBlock[] {
  const blocks: ExerciseBlock[] = [];
  for (const ex of exercises) {
    const last = blocks[blocks.length - 1];
    if (last && last.name === ex.exercise_name) {
      last.sets.push({ reps: ex.reps, weight: ex.weight, bodyweight: ex.bodyweight, rpe: ex.rpe });
    } else {
      blocks.push({
        name: ex.exercise_name,
        muscle_group: ex.muscle_group,
        sets: [{ reps: ex.reps, weight: ex.weight, bodyweight: ex.bodyweight, rpe: ex.rpe }],
      });
    }
  }
  return blocks;
}

export default function PlanCard({ log, onDeleted, onEdit }: { log: TrainingLog; onDeleted?: () => void; onEdit?: (id: number) => void }) {
  const blocks = groupExercises(log.exercises);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState(false);

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    const res = await fetch(`/api/training?id=${log.id}`, { method: "DELETE" });
    if (res.ok) {
      onDeleted?.();
      setConfirmDelete(false);
    } else {
      setConfirmDelete(false);
      setDeleteError(true);
    }
  };

  return (
    <article className="animate-fade-up group py-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-sm text-ink">{log.date}</span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {log.total_volume ? <span className="text-xs text-ink-3">总容量 {log.total_volume.toFixed(0)} kg</span> : null}
          {log.rpe ? <span className="text-xs text-ink-3">整体 RPE {log.rpe}</span> : null}
          {log.duration ? <span className="text-xs text-ink-3">{log.duration} min</span> : null}
          <div className="flex gap-1 opacity-100 transition-opacity md:opacity-0 md:focus-within:opacity-100 md:group-hover:opacity-100">
            {onEdit && (
              <button onClick={() => onEdit(log.id)} className="btn btn-ghost btn-sm">
                编辑
              </button>
            )}
            <button
              onClick={handleDelete}
              onBlur={() => setConfirmDelete(false)}
              className={`btn btn-ghost btn-sm ${confirmDelete ? "text-zone-red" : "hover:text-zone-red"}`}
            >
              {confirmDelete ? "确认?" : "删除"}
            </button>
          </div>
          {deleteError && (
            <span className="text-xs text-zone-red">删除失败，请重试</span>
          )}
        </div>
      </div>
      <div className="space-y-2">
        {blocks.map((block, i) => (
          <div key={i}>
            <div className="text-sm text-ink">
              {block.name}
              <span className="ml-2 text-xs text-ink-3">[{block.muscle_group}] {block.sets.length}组</span>
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-xs text-ink-2">
              {block.sets.map((s, j) => (
                <span key={j}>
                  {j + 1}. {s.reps || "?"}次
                  {s.bodyweight ? " 自重" : s.weight ? ` ${s.weight}kg` : ""}
                  {s.rpe ? ` RPE${s.rpe}` : ""}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
