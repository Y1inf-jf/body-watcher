"use client";

import { useState, useRef } from "react";
import { Sparkles } from "lucide-react";
import { Card, CardTitle } from "./ui/Card";

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
    <Card className="animate-fade-up p-4">
      <CardTitle
        right={
          <div className="flex gap-2">
            <button
              onClick={generate}
              disabled={generating}
              className="flex items-center gap-1.5 rounded border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
            >
              <Sparkles size={12} strokeWidth={2} />
              {generating ? "分析中..." : "生成总结"}
            </button>
            {generating && (
              <button onClick={() => abortRef.current?.abort()} className="text-xs text-zinc-500 hover:text-zone-red">
                取消
              </button>
            )}
          </div>
        }
      >
        Weekly Summary · 本周训练总结
      </CardTitle>
      {text && (
        <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-300">{text}</pre>
      )}
    </Card>
  );
}
