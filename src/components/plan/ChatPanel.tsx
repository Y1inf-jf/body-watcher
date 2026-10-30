"use client";

import type { RefObject } from "react";
import ChatMessages from "./ChatMessages";
import ChatEmptyState from "./ChatEmptyState";
import ChatInput from "./ChatInput";
import type { ChatMessage } from "./types";

// 对话栏:头 + 消息区(空时引导) + 输入框。返回 Fragment,由页面外层决定布局容器。
export default function ChatPanel({
  viewing,
  title,
  streaming,
  messages,
  bottomRef,
  input,
  onInputChange,
  onSend,
  onStop,
  onClose,
}: {
  viewing: boolean;
  title: string;
  streaming: boolean;
  messages: ChatMessage[];
  bottomRef: RefObject<HTMLDivElement | null>;
  input: string;
  onInputChange: (v: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line">
        {viewing ? (
          <>
            <span className="min-w-0 truncate text-sm font-medium text-ink">{title}</span>
            <button
              onClick={onClose}
              disabled={streaming}
              className="btn btn-ghost btn-sm shrink-0"
            >
              收起
            </button>
          </>
        ) : (
          <span className="truncate text-sm text-accent">新对话（未保存,发送后创建）</span>
        )}
      </div>

      <div className="py-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:pr-2">
        {messages.length > 0 ? (
          <ChatMessages messages={messages} bottomRef={bottomRef} />
        ) : viewing ? (
          <p className="py-10 text-center text-sm text-ink-3">加载中…</p>
        ) : (
          <ChatEmptyState onPrompt={onSend} disabled={streaming} />
        )}
      </div>

      <ChatInput
        value={input}
        onChange={onInputChange}
        onSend={() => onSend(input)}
        onStop={onStop}
        streaming={streaming}
        placeholder={viewing ? "追问/修正,如:胸没恢复今天别排胸" : "输入第一条消息,开始新对话"}
      />
    </>
  );
}
