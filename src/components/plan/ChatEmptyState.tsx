import { HeartPulse, ClipboardList } from "lucide-react";

// 草稿对话为空时的引导:说明 + 两个快捷起头。
export default function ChatEmptyState({
  onPrompt,
  disabled,
}: {
  onPrompt: (text: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex animate-fade-up flex-col items-center justify-center py-10 text-center lg:h-full lg:py-0">
      <p className="mb-2 text-ink">和你的 AI 教练对话</p>
      <p className="mx-auto mb-6 max-w-md text-sm text-ink-3">
        它能读取你的恢复分、睡眠、训练状态和全部训练历史;生成后可以继续追问,让它按你的体感修正。
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        <button
          onClick={() => onPrompt("请分析我今天的恢复情况,并给出今天训练的建议。")}
          disabled={disabled}
          className="btn btn-secondary"
        >
          <HeartPulse size={15} /> 恢复分析
        </button>
        <button
          onClick={() => onPrompt("请根据我的恢复情况和训练历史,生成下一次训练计划。")}
          disabled={disabled}
          className="btn btn-primary"
        >
          <ClipboardList size={15} /> 生成训练计划
        </button>
      </div>
    </div>
  );
}
