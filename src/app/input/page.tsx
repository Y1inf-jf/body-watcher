"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import HealthForm from "@/components/HealthForm";
import TrainingForm from "@/components/TrainingForm";
import PageHeader from "@/components/ui/PageHeader";
import Section from "@/components/ui/Section";
import Notice from "@/components/ui/Notice";

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
    <div className="mx-auto max-w-4xl">
      <PageHeader title="手动录入" description="计划执行预填与补录入口" />
      {planParam && (
        <Notice tone="info" className="mb-8">
          已从训练计划预填动作，请根据实际训练情况调整组数、重量、次数后保存。
        </Notice>
      )}
      <Section index="01" title="每日健康指标">
        <HealthForm />
      </Section>
      <Section
        index="02"
        title={editId ? `编辑训练记录 #${editId}` : "训练记录"}
        className="mt-10"
        aside={
          (editId || dateParam || planParam) && (
            <a href="/input" className="text-sm text-accent underline-offset-4 hover:underline">
              新建记录
            </a>
          )
        }
      >
        <TrainingForm
          editId={editId ? parseInt(editId) : null}
          initialDate={dateParam || undefined}
          templateData={planParam}
          templateKey={planKey}
          planId={Number.isInteger(planId) && planId > 0 ? planId : null}
        />
      </Section>
    </div>
  );
}

export default function InputPage() {
  return (
    <Suspense fallback={<div className="text-ink-3">加载中...</div>}>
      <InputContent />
    </Suspense>
  );
}
