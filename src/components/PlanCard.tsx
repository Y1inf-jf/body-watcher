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
