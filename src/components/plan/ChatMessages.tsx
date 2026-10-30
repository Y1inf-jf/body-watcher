import type { RefObject } from "react";
import Markdown from "@/components/Markdown";
import type { ChatMessage } from "./types";

// 消息流:用户气泡 + 教练 Markdown 回复;末尾哨兵供页面自动滚到底。
export default function ChatMessages({
  messages,
  bottomRef,
}: {
  messages: ChatMessage[];
  bottomRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="space-y-4">
      {messages.map((m, i) =>
        m.role === "user" ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-sm border border-line bg-surface-2 px-3.5 py-2 text-sm text-ink">
              {m.content}
            </div>
          </div>
        ) : (
          <div key={i} className="animate-fade-up border-l border-line pl-4">
            <div className="mb-1 text-xs text-ink-3">教练</div>
            <Markdown>{m.content || "…"}</Markdown>
          </div>
        )
      )}
      {/* 滚动哨兵:scroll-mb 避开底部 sticky 输入框与 tab bar */}
      <div
        ref={bottomRef}
        className="scroll-mb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+4.5rem)] md:scroll-mb-20 lg:scroll-mb-0"
      />
    </div>
  );
}
