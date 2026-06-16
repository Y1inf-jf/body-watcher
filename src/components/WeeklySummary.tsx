"use client";

import { useState, useRef } from "react";

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
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-zinc-400">本周训练总结</h3>
        <div className="flex gap-2">
          <button
            onClick={generate}
            disabled={generating}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-3 py-1 rounded text-xs font-medium"
          >
            {generating ? "分析中..." : "生成总结"}
          </button>
          {generating && (
            <button onClick={() => abortRef.current?.abort()} className="text-red-400 text-xs">
              取消
            </button>
          )}
        </div>
      </div>
      {text && (
        <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed">{text}</pre>
      )}
    </div>
  );
}
