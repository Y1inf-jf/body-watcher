"use client";

import { useState, useRef } from "react";
import { Sparkles } from "lucide-react";

export default function WeeklySummary() {
  const [generating, setGenerating] = useState(false);
  const [text, setText] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const generate = async () => {
    setGenerating(true);
    setText("");
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/agent?mode=summary", {
        method: "POST",
        signal: abortRef.current.signal,
      });
      if (!res.ok) {
        setText("生成失败，请检查 API Key 配置");
        return;
      }
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setText((prev) => prev + decoder.decode(value, { stream: true }));
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setText("生成失败");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <h3 className="text-sm font-medium text-ink">本周训练总结</h3>
        <div className="flex gap-2">
          <button onClick={generate} disabled={generating} className="btn btn-secondary btn-sm">
            <Sparkles size={12} strokeWidth={2} />
            {generating ? "分析中..." : "生成总结"}
          </button>
          {generating && (
            <button onClick={() => abortRef.current?.abort()} className="btn btn-ghost btn-sm">
              取消
            </button>
          )}
        </div>
      </div>
      {text && (
        <pre className="mt-4 whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-2">{text}</pre>
      )}
    </div>
  );
}
