"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import HealthForm from "@/components/HealthForm";
import TrainingForm from "@/components/TrainingForm";

function InputContent() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const dateParam = searchParams.get("date");

  return (
    <div className="max-w-4xl space-y-8">
      <section>
        <h2 className="text-lg font-semibold mb-3">每日健康指标</h2>
        <HealthForm />
      </section>
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">
            {editId ? `编辑训练记录 #${editId}` : "训练记录"}
          </h2>
          {(editId || dateParam) && (
            <a href="/input" className="text-zinc-400 hover:text-zinc-200 text-sm">
              新建记录
            </a>
          )}
        </div>
        <TrainingForm editId={editId ? parseInt(editId) : null} initialDate={dateParam || undefined} />
      </section>
    </div>
  );
}

export default function InputPage() {
  return (
    <Suspense fallback={<div className="text-zinc-500">加载中...</div>}>
      <InputContent />
    </Suspense>
  );
}
