"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Send, Square, Plus, Trash2, Pin, ClipboardList, HeartPulse } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface CoachNote {
  id: number;
  content: string;
  source: string;
  pinned: number;
  expires_at: string | null;
  created_at: string;
}

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
// expires_at 是"有效期至",当天仍有效、次日过期(与注入侧 SQL 的 expires_at > now 口径一致)。
const isExpired = (date: string | null) => date !== null && date < todayStr();

export default function PlanPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [notes, setNotes] = useState<CoachNote[]>([]);
  const [noteInput, setNoteInput] = useState("");
  const [pinNew, setPinNew] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchNotes = useCallback(() => {
    fetch("/api/coach-notes")
      .then((r) => r.json())
      .then((d) => setNotes(d.notes ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  // 新消息/流式输出时滚到底部。
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || streaming) return;
      const history = [...messages, { role: "user" as const, content }];
      setMessages([...history, { role: "assistant", content: "" }]);
      setInput("");
      setStreaming(true);
      abortRef.current = new AbortController();

      const patchLast = (patch: Partial<ChatMessage>) =>
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { ...copy[copy.length - 1], ...patch };
          return copy;
        });

      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history }),
          signal: abortRef.current.signal,
        });
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          patchLast({ content: `[生成失败：${j?.error ?? res.status}]` });
          return;
        }
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) return;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            copy[copy.length - 1] = { ...last, content: last.content + chunk };
            return copy;
          });
        }
        // 对话结束后刷新一次笔记;后台记忆整理稍晚落库,延迟几秒再刷一次。
        fetchNotes();
        setTimeout(fetchNotes, 6000);
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          patchLast({ content: "[生成失败,请重试]" });
        }
      } finally {
        setStreaming(false);
      }
    },
    [messages, streaming, fetchNotes]
  );

  const addNote = async () => {
    const content = noteInput.trim();
    if (!content) return;
    await fetch("/api/coach-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, pinned: pinNew ? 1 : 0 }),
    });
    setNoteInput("");
    setPinNew(false);
    fetchNotes();
  };

  const togglePin = async (n: CoachNote) => {
    await fetch("/api/coach-notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: n.id, pinned: n.pinned ? 0 : 1 }),
    });
    fetchNotes();
  };

  const deleteNote = async (id: number) => {
    await fetch(`/api/coach-notes?id=${id}`, { method: "DELETE" });
    fetchNotes();
  };

  const empty = messages.length === 0;

  return (
    <div className="flex max-w-4xl flex-col">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold">训练计划 · AI 教练</h2>
      </div>

      {/* 教练笔记:长期记忆层,Agent 对话中也会自动写入 */}
      <details className="panel mb-4 p-4" open={notes.length > 0}>
        <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">
          Coach Notes · 教练笔记（{notes.length}）—— 每次对话都会带上
        </summary>
        <div className="mt-3 space-y-1.5">
          {notes.length === 0 && (
            <p className="text-xs text-zinc-600">
              暂无。对话中告诉教练你的个人情况(伤病史/恢复规律/偏好),它会自动记下来;也可以在这里手动添加。
            </p>
          )}
          {notes.map((n) => (
            <div
              key={n.id}
              className="flex items-center justify-between gap-3 rounded border border-white/5 bg-white/[0.02] px-2.5 py-1.5"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm text-zinc-300">
                {n.pinned === 1 && (
                  <span className="shrink-0 rounded bg-zone-red/10 px-1.5 py-0.5 text-[10px] text-zone-red">硬约束</span>
                )}
                <span className={isExpired(n.expires_at) ? "text-zinc-600 line-through" : ""}>{n.content}</span>
                {n.expires_at && (
                  <span className="shrink-0 text-[10px] text-zinc-600">
                    {isExpired(n.expires_at) ? "已过期" : `至 ${n.expires_at}`}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-[10px] text-zinc-600">{n.created_at}</span>
                <button
                  onClick={() => togglePin(n)}
                  className={n.pinned ? "text-zone-red" : "text-zinc-600 transition-colors hover:text-zinc-300"}
                  aria-label={n.pinned ? "取消硬约束" : "置顶为硬约束"}
                >
                  <Pin size={13} />
                </button>
                <button
                  onClick={() => deleteNote(n.id)}
                  className="text-zinc-600 transition-colors hover:text-zone-red"
                  aria-label="删除笔记"
                >
                  <Trash2 size={13} />
                </button>
              </span>
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <input
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addNote()}
              placeholder="手动添加一条,如:膝盖旧伤,避免深蹲"
              className="flex-1 rounded border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
            />
            <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-zinc-500">
              <input
                type="checkbox"
                checked={pinNew}
                onChange={(e) => setPinNew(e.target.checked)}
                className="accent-red-400"
              />
              硬约束
            </label>
            <button
              onClick={addNote}
              disabled={!noteInput.trim()}
              className="flex items-center gap-1 rounded border border-accent/30 bg-accent/10 px-2.5 text-xs text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
            >
              <Plus size={13} /> 添加
            </button>
          </div>
        </div>
      </details>

      {/* 对话区 */}
      {empty ? (
        <div className="panel animate-fade-up p-6 text-center">
          <p className="mb-2 text-zinc-300">和你的 AI 教练对话</p>
          <p className="mb-5 text-sm text-zinc-600">
            它能读取你的恢复分、睡眠、训练状态和全部训练历史;生成后可以继续追问,让它按你的体感修正。
          </p>
          <div className="flex justify-center gap-3">
            <button
              onClick={() => send("请分析我今天的恢复情况,并给出今天训练的建议。")}
              disabled={streaming}
              className="flex items-center gap-2 rounded-lg border border-zone-green/30 bg-zone-green/10 px-4 py-2 text-sm font-medium text-zone-green transition-colors hover:bg-zone-green/20 disabled:opacity-50"
            >
              <HeartPulse size={15} /> 恢复分析
            </button>
            <button
              onClick={() => send("请根据我的恢复情况和训练历史,生成下一次训练计划。")}
              disabled={streaming}
              className="flex items-center gap-2 rounded-lg bg-accent/90 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-accent disabled:opacity-50"
            >
              <ClipboardList size={15} /> 生成训练计划
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] whitespace-pre-wrap rounded-lg rounded-br-sm border border-accent/25 bg-accent/10 px-3.5 py-2 text-sm text-zinc-100">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="panel animate-fade-up p-4">
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-300">
                  {m.content || "…"}
                </pre>
              </div>
            )
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {/* 输入区 */}
      <div className="mt-4 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && send(input)}
          disabled={streaming || empty}
          placeholder={empty ? "先从上面的按钮开始对话" : "追问/修正,如:胸没恢复今天别排胸"}
          className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none disabled:opacity-50"
        />
        {streaming ? (
          <button
            onClick={() => abortRef.current?.abort()}
            className="flex items-center gap-1.5 rounded-lg border border-zone-red/40 bg-zone-red/10 px-4 text-sm text-zone-red transition-colors hover:bg-zone-red/20"
          >
            <Square size={13} /> 停止
          </button>
        ) : (
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || empty}
            className="flex items-center gap-1.5 rounded-lg bg-accent/90 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-accent disabled:opacity-40"
          >
            <Send size={14} /> 发送
          </button>
        )}
      </div>

      {/* 历史计划:保留执行闭环,默认收起不占版面 */}
      <details className="panel mt-5 p-4">
        <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">
          Plan History · 历史计划
        </summary>
        <div className="mt-3">
          <PlanHistorySection />
        </div>
      </details>
    </div>
  );
}

function PlanHistorySection() {
  const [
    plans,
    setPlans,
  ] = useState<
    {
      id: number;
      date: string;
      plan_date: string | null;
      analysis_summary: string;
      recovery_assessment: string;
      exercises: string;
      advice: string;
    }[]
  >([]);

  useEffect(() => {
    fetch("/api/plans")
      .then((r) => r.json())
      .then((d) => setPlans(d.plans ?? []))
      .catch(() => {});
  }, []);

  if (plans.length === 0) return <p className="text-sm text-zinc-600">暂无训练计划</p>;

  return (
    <div className="space-y-3">
      {plans.map((plan) => {
        let exercises: { name: string; muscle_group: string; sets: number; reps: number; weight: number }[] = [];
        try {
          exercises = JSON.parse(plan.exercises || "[]");
        } catch {}
        const execPlanHref = `/input?plan=${encodeURIComponent(plan.exercises || "[]")}`;
        return (
          <details key={plan.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
            <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm">
              <span className="font-medium text-zinc-200">
                {plan.date}
                {plan.plan_date && <span className="ml-2 text-xs text-zinc-500">目标: {plan.plan_date}</span>}
              </span>
              <span className="text-xs text-zinc-500">{exercises.length} 个动作</span>
            </summary>
            <div className="mt-3 space-y-3">
              <div className="border-l-2 border-accent/70 pl-3">
                <div className="mb-1 text-xs text-zinc-500">分析摘要</div>
                <div className="text-sm text-zinc-300">{plan.analysis_summary}</div>
              </div>
              <div className="border-l-2 border-zone-amber/70 pl-3">
                <div className="mb-1 text-xs text-zinc-500">恢复评估</div>
                <div className="text-sm text-zinc-300">{plan.recovery_assessment}</div>
              </div>
              {exercises.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs text-zinc-500">训练动作</div>
                    <a
                      href={execPlanHref}
                      className="rounded border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
                    >
                      执行
                    </a>
                  </div>
                  <div className="space-y-2">
                    {exercises.map((ex, i) => (
                      <div key={i} className="rounded-lg border border-white/5 bg-white/[0.02] p-2">
                        <div className="text-sm text-zinc-200">
                          <span className="mr-2 text-xs text-zinc-500">[{ex.muscle_group}]</span>
                          <span className="font-medium">{ex.name}</span>
                          <span className="ml-2 text-xs text-zinc-500">{ex.sets}组</span>
                        </div>
                        <div className="ml-1 mt-0.5 text-xs text-zinc-400">
                          {ex.sets}组 × {ex.reps}次
                          {ex.weight ? ` @ ${ex.weight}kg` : " 自重"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {plan.advice && (
                <div className="border-l-2 border-zone-green/70 pl-3">
                  <div className="mb-1 text-xs text-zinc-500">建议</div>
                  <div className="text-sm text-zinc-300">{plan.advice}</div>
                </div>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}
