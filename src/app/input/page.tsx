"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import HealthForm from "@/components/HealthForm";
import TrainingForm from "@/components/TrainingForm";

function InputContent() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const dateParam = searchParams.get("date");
  const planParam = searchParams.get("plan");
  // 建议闭环:从计划卡"执行"进来带上计划 id,保存训练时回链并自动销账该计划的建议。
  const planId = parseInt(searchParams.get("planId") || "");

  // 执行训练计划：URL 的 plan 参数是编码后的动作 JSON，
  // 交给 TrainingForm 的 templateData 预填机制。templateKey 用 planParam
  // 的长度作为变化源，使「重新执行同一计划」也能再次触发预填 effect。
  const planKey = planParam ? planParam.length : 0;

  return (
    <div className="max-w-4xl space-y-8">
      {planParam && (
        <div className="bg-blue-950/40 border border-blue-800/50 rounded-lg p-3 text-sm text-blue-200">
          已从训练计划预填动作，请根据实际训练情况调整组数、重量、次数后保存。
        </div>
      )}
      <section>
        <h2 className="text-lg font-semibold mb-3">每日健康指标</h2>
        <HealthForm />
      </section>
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">
            {editId ? `编辑训练记录 #${editId}` : "训练记录"}
          </h2>
          {(editId || dateParam || planParam) && (
            <a href="/input" className="text-zinc-400 hover:text-zinc-200 text-sm">
              新建记录
            </a>
          )}
        </div>
        <TrainingForm
          editId={editId ? parseInt(editId) : null}
          initialDate={dateParam || undefined}
          templateData={planParam}
          templateKey={planKey}
          planId={Number.isInteger(planId) && planId > 0 ? planId : null}
        />
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
