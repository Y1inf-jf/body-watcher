import { Send, Square } from "lucide-react";

// 输入区:手机/平板吸底(tab bar 上方),桌面固定在对话栏底部。
export default function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  placeholder: string;
}) {
  return (
    <div className="sticky bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+0.5rem)] z-10 -mx-1 mt-4 flex gap-2 rounded-md bg-bg/95 p-1 backdrop-blur md:bottom-4 lg:static lg:mx-0 lg:mt-0 lg:shrink-0 lg:rounded-none lg:border-t lg:border-line lg:bg-transparent lg:p-0 lg:pt-3 lg:backdrop-blur-none">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && onSend()}
        disabled={streaming}
        placeholder={placeholder}
        className="field min-w-0 flex-1"
      />
      {streaming ? (
        <button onClick={onStop} className="btn btn-danger shrink-0">
          <Square size={13} /> 停止
        </button>
      ) : (
        <button onClick={onSend} disabled={!value.trim()} className="btn btn-primary shrink-0">
          <Send size={14} /> 发送
        </button>
      )}
    </div>
  );
}
