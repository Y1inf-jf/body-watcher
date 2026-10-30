"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Trash2 } from "lucide-react";
import Disclosure from "./ui/Disclosure";

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
    <div className="animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <h3 className="text-sm font-medium text-ink">阶段复盘（近 30 天）</h3>
        <div className="flex gap-2">
          <button onClick={generate} disabled={generating} className="btn btn-secondary btn-sm">
            <Sparkles size={12} strokeWidth={2} />
            {generating ? "复盘生成中..." : "生成本月复盘"}
          </button>
          {generating && (
            <button onClick={() => abortRef.current?.abort()} className="btn btn-ghost btn-sm">
              取消
            </button>
          )}
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-ink-3">
        汇总近 30 天的恢复分快照、训练量、体成分与建议采纳情况,给出趋势解读与下阶段重点。生成后自动存档。
      </p>

      {(text || error) && (
        <pre className="mt-4 whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-2">
          {error ? "生成失败，请检查 API Key 配置" : text}
        </pre>
      )}

      {reports.length > 0 && (
        <div className="mt-6">
          <div className="mb-1 text-xs text-ink-3">历史复盘（{reports.length}）</div>
          <div className="divide-y divide-line border-y border-line">
            {reports.map((r) => (
              <Disclosure
                key={r.id}
                summary={
                  <span className="font-mono text-sm text-ink">
                    {r.period_start.slice(5)} ~ {r.period_end.slice(5)}
                  </span>
                }
                meta={<span className="font-mono text-[11px] text-ink-3">{r.created_at.slice(5, 16)}</span>}
                actions={
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      remove(r.id);
                    }}
                    className="grid h-8 w-8 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-zone-red"
                    aria-label="删除该复盘"
                  >
                    <Trash2 size={13} />
                  </button>
                }
              >
                <pre className="whitespace-pre-wrap pb-3 font-sans text-sm leading-relaxed text-ink-2">{r.content}</pre>
              </Disclosure>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
