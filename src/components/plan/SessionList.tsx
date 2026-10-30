import { Check, Trash2 } from "lucide-react";
import { sessionLabel, type ChatSession } from "./types";

// 历史对话列表:点击条目在对话区展开/收起,删除走上层回调。
export default function SessionList({
  sessions,
  activeId,
  streaming,
  onToggle,
  onRemove,
}: {
  sessions: ChatSession[];
  activeId: number | null;
  streaming: boolean;
  onToggle: (id: number) => void;
  onRemove: (id: number) => void;
}) {
  return (
    <div className="@container">
      <p className="py-3 text-xs text-ink-3">历史对话（{sessions.length}）· 点击条目在对话区展开</p>
      {sessions.length === 0 && <p className="text-xs text-ink-3">暂无历史对话</p>}
      {sessions.map((s) => {
        const active = s.id === activeId;
        return (
          <div
            key={s.id}
            className={`flex items-start justify-between gap-3 border-t border-line px-1 py-2.5 first:border-t-0 ${
              active ? "bg-surface-2" : ""
            }`}
          >
            <button
              onClick={() => onToggle(s.id)}
              disabled={streaming}
              title={active ? "点击收起该对话" : "在对话区展开该对话"}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm text-ink transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              {active ? <Check size={13} className="shrink-0 text-accent" /> : null}
              <span className="truncate">{s.title || "未命名对话"}</span>
            </button>
            <span className="flex shrink-0 items-center gap-2">
              <span className="font-mono text-[11px] text-ink-3">
                {sessionLabel(s)} · {s.message_count} 条
              </span>
              <button
                onClick={() => onRemove(s.id)}
                disabled={streaming}
                className="grid h-8 w-8 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-zone-red disabled:opacity-40"
                aria-label="删除该对话"
              >
                <Trash2 size={14} />
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
