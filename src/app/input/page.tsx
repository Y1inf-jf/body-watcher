import HealthForm from "@/components/HealthForm";
import TrainingForm from "@/components/TrainingForm";

export default function InputPage() {
  return (
    <div className="max-w-4xl space-y-8">
      <section>
        <h2 className="text-lg font-semibold mb-3">每日健康指标</h2>
        <HealthForm />
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-3">训练记录</h2>
        <TrainingForm />
      </section>
    </div>
  );
}
