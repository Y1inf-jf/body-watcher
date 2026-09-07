"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Trash2 } from "lucide-react";
import { Card, CardTitle } from "./ui/Card";

interface Report {
  id: number;
  kind: "monthly";
  period_start: string;
  period_end: string;
  content: string;
  created_at: string;
}

// 阶段复盘(月报):流式生成,完成后落库;历史列表可回看/删除。
export default function MonthlyReview() {
  const [reports, setReports] = useState<Report[]>([]);
  const [generating, setGenerating] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    fetch("/api/reports")
      .then((r) => r.json())
      .then((d) => setReports(d.reports ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const generate = async () => {
    setGenerating(true);
    setError(false);
    setText("");
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/agent?mode=monthly", {
        method: "POST",
        signal: abortRef.current.signal,
      });
      if (!res.ok) {
        setError(true);
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
      if ((e as Error).name !== "AbortError") setError(true);
    } finally {
      setGenerating(false);
      // 复盘全文在流结束后落库,稍等片刻再刷新列表。
      setTimeout(load, 2500);
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm("删除这份复盘?不可恢复。")) return;
    await fetch(`/api/reports?id=${id}`, { method: "DELETE" });
    load();
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
              {generating ? "复盘生成中..." : "生成本月复盘"}
            </button>
            {generating && (
              <button onClick={() => abortRef.current?.abort()} className="text-xs text-zinc-500 hover:text-zone-red">
                取消
              </button>
            )}
          </div>
        }
      >
        Monthly Review · 阶段复盘（近 30 天）
      </CardTitle>
      <p className="mt-2 text-xs leading-relaxed text-zinc-500">
        汇总近 30 天的恢复分快照、训练量、体成分与建议采纳情况,给出趋势解读与下阶段重点。生成后自动存档。
      </p>

      {(text || error) && (
        <div className="mt-3 rounded-lg border border-white/5 bg-white/[0.02] p-3">
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-300">
            {error ? "生成失败，请检查 API Key 配置" : text}
          </pre>
        </div>
      )}

      {reports.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">
            历史复盘（{reports.length}）
          </div>
          {reports.map((r) => (
            <details key={r.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-2.5">
              <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium text-zinc-200">
                  {r.period_start.slice(5)} ~ {r.period_end.slice(5)}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-[10px] text-zinc-600">{r.created_at.slice(5, 16)}</span>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      remove(r.id);
                    }}
                    className="text-zinc-600 transition-colors hover:text-zone-red"
                    aria-label="删除该复盘"
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </summary>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-300">{r.content}</pre>
            </details>
          ))}
        </div>
      )}
    </Card>
  );
}
