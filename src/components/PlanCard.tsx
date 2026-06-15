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

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    await fetch(`/api/training?id=${log.id}`, { method: "DELETE" });
    onDeleted?.();
    setConfirmDelete(false);
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 group">
      <div className="flex items-center justify-between mb-3">
        <span className="font-medium">{log.date}</span>
        <div className="flex gap-3 items-center">
          {log.total_volume ? <span className="text-xs text-zinc-400">总容量 {log.total_volume.toFixed(0)} kg</span> : null}
          {log.rpe ? <span className="text-xs text-zinc-400">整体 RPE {log.rpe}</span> : null}
          {log.duration ? <span className="text-xs text-zinc-400">{log.duration} min</span> : null}
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {onEdit && (
              <button onClick={() => onEdit(log.id)} className="text-xs text-zinc-500 hover:text-blue-400 px-1">
                编辑
              </button>
            )}
            <button
              onClick={handleDelete}
              onBlur={() => setConfirmDelete(false)}
              className={`text-xs px-1 ${confirmDelete ? "text-red-400" : "text-zinc-500 hover:text-red-400"}`}
            >
              {confirmDelete ? "确认?" : "删除"}
            </button>
          </div>
        </div>
      </div>
      <div className="space-y-2">
        {blocks.map((block, i) => (
          <div key={i} className="bg-zinc-800/50 border border-zinc-700/50 rounded p-2">
            <div className="text-sm text-zinc-200 mb-1">
              <span className="text-zinc-500 text-xs mr-2">[{block.muscle_group}]</span>
              {block.name}
              <span className="text-zinc-500 ml-1">{block.sets.length}组</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 ml-2 text-xs text-zinc-400">
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
    </div>
  );
}
