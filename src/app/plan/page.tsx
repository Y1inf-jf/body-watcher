"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Send,
  Square,
  Plus,
  Trash2,
  Pin,
  ClipboardList,
  HeartPulse,
  MessageSquarePlus,
  Check,
} from "lucide-react";
import Markdown from "@/components/Markdown";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatSession {
  id: number;
  title: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
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

// 会话列表右侧时间标签:当天只显时间,跨年带年份。
const sessionLabel = (s: ChatSession) => {
  const d = s.updated_at.slice(0, 10);
  const hm = s.updated_at.slice(11, 16);
  if (d === todayStr()) return `今天 ${hm}`;
  return d.slice(0, 5) === todayStr().slice(0, 5) ? d.slice(5) : d;
};

export default function PlanPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [notes, setNotes] = useState<CoachNote[]>([]);
  const [noteInput, setNoteInput] = useState("");
  const [pinNew, setPinNew] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  // send 闭包拿不到最新 sessionId,用 ref 同步兜底建会话后的响应头值。
  const sessionIdRef = useRef<number | null>(null);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const fetchNotes = useCallback(() => {
    fetch("/api/coach-notes")
      .then((r) => r.json())
      .then((d) => setNotes(d.notes ?? []))
      .catch(() => {});
  }, []);

  const fetchSessions = useCallback(async (): Promise<ChatSession[]> => {
    try {
      const d = await (await fetch("/api/chat")).json();
      // 0 消息的会话只在"建会话后生成失败"时残留,不展示。
      const list: ChatSession[] = (d.sessions ?? []).filter((s: ChatSession) => s.message_count > 0);
      setSessions(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  const openSession = useCallback((id: number) => {
    fetch(`/api/chat?sessionId=${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.messages)) {
          setMessages(
            d.messages.map((m: { role: string; content: string }) => ({
              role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
              content: m.content,
            }))
          );
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchNotes();
    // 只拉会话列表,不自动打开任何会话(ChatGPT 式):点历史条目才展开,进页保持干净。
    void (async () => {
      await fetchSessions();
      setHistoryLoaded(true);
    })();
  }, [fetchNotes, fetchSessions]);

  // 新消息/流式输出时滚到底部。
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const [composing, setComposing] = useState(false);
  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || streaming) return;
      const history = [...messages, { role: "user" as const, content }];
      setMessages([...history, { role: "assistant", content: "" }]);
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
          body: JSON.stringify({
            messages: history,
            ...(sessionIdRef.current ? { sessionId: sessionIdRef.current } : {}),
          }),
          signal: abortRef.current.signal,
        });
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          patchLast({ content: `[生成失败：${j?.error ?? res.status}]` });
          return;
        }
        // 新对话首发:服务端建了会话,经响应头拿回 id。
        const sid = Number(res.headers.get("X-Chat-Session"));
        if (Number.isInteger(sid) && sid > 0 && sessionIdRef.current !== sid) {
          sessionIdRef.current = sid;
          setSessionId(sid);
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
        // 对话结束后:先等会话列表刷新,让草稿卡无闪烁交棒给真实会话条目;
        // 后台记忆整理稍晚落库,笔记延迟几秒再刷一次。
        await fetchSessions();
        setComposing(false);
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
    [messages, streaming, fetchNotes, fetchSessions]
  );

  const closeConversation = () => {
    if (streaming) return;
    setSessionId(null);
    sessionIdRef.current = null;
    setMessages([]);
  };

  // 新建对话草稿:不立刻建会话,首条消息发出时由服务端落库,避免空会话堆积。
  const newChat = () => {
    if (streaming) return;
    closeConversation();
    setComposing(true);
  };

  // 列表条目点击 = 就地展开/收起该会话(与草稿卡互斥,同屏只开一个)。
  const toggleSession = (id: number) => {
    if (streaming) return;
    setComposing(false);
    if (id === sessionId) {
      closeConversation();
      return;
    }
    setSessionId(id);
    openSession(id);
  };

  const removeSession = async (id: number) => {
    if (streaming) return;
    if (!window.confirm("删除这条对话?全部消息将一并移除,不可恢复。")) return;
    await fetch(`/api/chat?id=${id}`, { method: "DELETE" });
    if (id === sessionId) closeConversation();
    fetchSessions();
  };

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

  // 草稿卡展示条件:正在新建,或尚无任何会话(首次引导)。
  const showComposer = composing || (historyLoaded && sessions.length === 0);

  return (
    <div className="flex max-w-4xl flex-col">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold">训练计划 · AI 教练</h2>
        <button
          onClick={newChat}
          disabled={streaming}
          className="flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
        >
          <MessageSquarePlus size={14} /> 新建对话
        </button>
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

      {/* 历史计划:保留执行闭环,默认收起不占版面 */}
      <details className="panel mb-4 p-4">
        <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">
          Plan History · 历史计划
        </summary>
        <div className="mt-3">
          <PlanHistorySection />
        </div>
      </details>

      {/* 会话列表即对话:每条是可展开的卡片,展开后就地显示消息流与追问输入 */}
      <div className="space-y-2">
        {/* 无会话时的引导卡:快捷起头 */}
        {historyLoaded && sessions.length === 0 && (
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
        )}

        {/* 新对话草稿卡:首条消息发出即建会话,流结束后由列表真条目接管。
            草稿展示期没有任何会话展开,故非空的 messages 必为本次新会话,就地流式显示。 */}
        {showComposer && (
          <div className="panel p-4">
            <div className="mb-2 text-xs font-medium text-accent">新对话（未保存,发送后创建）</div>
            {messages.length > 0 && <div className="mb-3 space-y-3">{renderMessages()}</div>}
            {renderInput("输入第一条消息,开始新对话")}
          </div>
        )}

        {/* 会话卡片 */}
        {sessions.map((s) => {
          const expanded = s.id === sessionId && !showComposer;
          return (
            <div
              key={s.id}
              className={`rounded-lg border p-3 transition-colors ${
                expanded ? "border-accent/40 bg-accent/[0.04]" : "border-white/5 bg-white/[0.02]"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => toggleSession(s.id)}
                  disabled={streaming}
                  title={expanded ? "点击收起该对话" : "就地展开该对话"}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm text-zinc-200 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {expanded ? <Check size={13} className="shrink-0 text-accent" /> : null}
                  <span className="truncate">{s.title || "未命名对话"}</span>
                </button>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-[10px] text-zinc-600">
                    {sessionLabel(s)} · {s.message_count} 条
                  </span>
                  <button
                    onClick={() => removeSession(s.id)}
                    disabled={streaming}
                    className="text-zinc-600 transition-colors hover:text-zone-red disabled:opacity-40"
                    aria-label="删除该对话"
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
              {expanded && (
                <div className="mt-3 space-y-3 border-t border-white/5 pt-3">
                  {renderMessages()}
                  {renderInput("追问/修正,如:胸没恢复今天别排胸")}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  // —— 渲染片段:消息流 + 输入区(草稿卡与展开会话共用同一套 send/streaming 状态)——
  function renderMessages() {
    return (
      <>
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] whitespace-pre-wrap rounded-lg rounded-br-sm border border-accent/25 bg-accent/10 px-3.5 py-2 text-sm text-zinc-100">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="panel animate-fade-up p-4">
              <Markdown>{m.content || "…"}</Markdown>
            </div>
          )
        )}
        <div ref={bottomRef} />
      </>
    );
  }

  function renderInput(placeholder: string) {
    return (
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && send(input)}
          disabled={streaming}
          placeholder={placeholder}
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
            disabled={!input.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-accent/90 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-accent disabled:opacity-40"
          >
            <Send size={14} /> 发送
          </button>
        )}
      </div>
    );
  }
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
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // 手动录入自己的训练计划(动作行可增删),保存后走与 AI 计划相同的"执行"闭环。
  const [showForm, setShowForm] = useState(false);
  const [planDate, setPlanDate] = useState(new Date().toISOString().split("T")[0]);
  const [targetDate, setTargetDate] = useState("");
  const [rows, setRows] = useState([
    { name: "", muscle_group: "", sets: "", reps: "", weight: "" },
  ]);
  const [advice, setAdvice] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(() => {
    fetch("/api/plans")
      .then((r) => r.json())
      .then((d) => setPlans(d.plans ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setPlanDate(new Date().toISOString().split("T")[0]);
    setTargetDate("");
    setRows([{ name: "", muscle_group: "", sets: "", reps: "", weight: "" }]);
    setAdvice("");
    setFormError("");
  };

  const savePlan = async () => {
    setFormError("");
    const exercises = rows
      .map((r) => ({
        name: r.name.trim(),
        muscle_group: r.muscle_group.trim(),
        sets: r.sets ? parseInt(r.sets) : NaN,
        reps: r.reps ? parseInt(r.reps) : NaN,
        weight: r.weight ? parseFloat(r.weight) : null,
      }))
      .filter((r) => r.name || r.muscle_group);
    if (exercises.length === 0) {
      setFormError("至少填一个动作");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: planDate,
          ...(targetDate ? { plan_date: targetDate } : {}),
          exercises,
          advice: advice || undefined,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFormError(json.error ?? "保存失败");
        return;
      }
      resetForm();
      setShowForm(false);
      load();
    } catch {
      setFormError("网络错误,未保存");
    } finally {
      setSaving(false);
    }
  };

  const removePlan = async (id: number) => {
    if (!window.confirm("删除这条历史计划?不可恢复。")) return;
    setDeletingId(id);
    try {
      await fetch(`/api/plans?id=${id}`, { method: "DELETE" });
      setPlans((prev) => prev.filter((p) => p.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  if (plans.length === 0 && !showForm) return <p className="text-sm text-zinc-600">暂无训练计划</p>;

  return (
    <div className="space-y-3">
      {/* 手动录入自己的计划:与 AI 计划同列表、同执行闭环 */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
        >
          {showForm ? "收起表单" : "新建计划"}
        </button>
      </div>

      {showForm && (
        <div className="rounded-lg border border-accent/30 bg-accent/[0.04] p-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5 text-zinc-400">
              计划日期
              <input
                type="date"
                value={planDate}
                onChange={(e) => setPlanDate(e.target.value)}
                className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-sm text-zinc-100 [color-scheme:dark]"
              />
            </label>
            <label className="flex items-center gap-1.5 text-zinc-400">
              目标日期(可选)
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-sm text-zinc-100 [color-scheme:dark]"
              />
            </label>
          </div>

          <div className="mt-3 space-y-1.5">
            <div className="flex gap-1.5 text-[10px] uppercase tracking-wider text-zinc-600">
              <span className="min-w-0 flex-1">动作</span>
              <span className="w-16 shrink-0">肌群</span>
              <span className="w-12 shrink-0">组</span>
              <span className="w-12 shrink-0">次</span>
              <span className="w-16 shrink-0">kg</span>
              <span className="w-5 shrink-0" />
            </div>
            {rows.map((r, i) => (
              <div key={i} className="flex gap-1.5">
                <input
                  value={r.name}
                  onChange={(e) =>
                    setRows((rs) => rs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                  }
                  placeholder="如 杠铃卧推"
                  className="min-w-0 flex-1 rounded border border-white/10 bg-white/[0.04] px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
                />
                <input
                  value={r.muscle_group}
                  onChange={(e) =>
                    setRows((rs) => rs.map((x, j) => (j === i ? { ...x, muscle_group: e.target.value } : x)))
                  }
                  placeholder="胸"
                  className="w-16 shrink-0 rounded border border-white/10 bg-white/[0.04] px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
                />
                <input
                  value={r.sets}
                  onChange={(e) =>
                    setRows((rs) => rs.map((x, j) => (j === i ? { ...x, sets: e.target.value } : x)))
                  }
                  inputMode="numeric"
                  placeholder="4"
                  className="w-12 shrink-0 rounded border border-white/10 bg-white/[0.04] px-2 py-1.5 text-center text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
                />
                <input
                  value={r.reps}
                  onChange={(e) =>
                    setRows((rs) => rs.map((x, j) => (j === i ? { ...x, reps: e.target.value } : x)))
                  }
                  inputMode="numeric"
                  placeholder="8"
                  className="w-12 shrink-0 rounded border border-white/10 bg-white/[0.04] px-2 py-1.5 text-center text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
                />
                <input
                  value={r.weight}
                  onChange={(e) =>
                    setRows((rs) => rs.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))
                  }
                  inputMode="decimal"
                  placeholder="自重"
                  className="w-16 shrink-0 rounded border border-white/10 bg-white/[0.04] px-2 py-1.5 text-center text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
                />
                <button
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                  className="w-5 shrink-0 text-zinc-600 transition-colors hover:text-zone-red"
                  aria-label="移除该动作"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <button
              onClick={() => setRows((rs) => [...rs, { name: "", muscle_group: "", sets: "", reps: "", weight: "" }])}
              className="flex items-center gap-1 text-xs text-accent transition-colors hover:text-accent/80"
            >
              <Plus size={12} /> 添加动作
            </button>
          </div>

          <textarea
            value={advice}
            onChange={(e) => setAdvice(e.target.value)}
            placeholder="注意事项(可选),如:组间休息 90 秒,最后一路做到力竭"
            rows={2}
            className="mt-3 w-full rounded border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
          />

          {formError && <p className="mt-2 text-xs text-zone-red">{formError}</p>}
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={savePlan}
              disabled={saving}
              className="rounded-lg bg-accent/90 px-4 py-1.5 text-xs font-semibold text-zinc-950 transition-colors hover:bg-accent disabled:opacity-40"
            >
              {saving ? "保存中..." : "保存计划"}
            </button>
            <span className="text-[11px] text-zinc-600">保存后出现在列表里,可点「执行」带入训记,自动闭环</span>
          </div>
        </div>
      )}

      {plans.map((plan) => {
        let exercises: { name: string; muscle_group: string; sets: number; reps: number; weight: number }[] = [];
        try {
          exercises = JSON.parse(plan.exercises || "[]");
        } catch {}
        const execPlanHref = `/input?plan=${encodeURIComponent(plan.exercises || "[]")}&planId=${plan.id}`;
        return (
          <details key={plan.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
            <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium text-zinc-200">
                {plan.date}
                {plan.plan_date && <span className="ml-2 text-xs text-zinc-500">目标: {plan.plan_date}</span>}
                {!plan.recovery_assessment && !plan.analysis_summary && (
                  <span className="ml-2 rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400">自建</span>
                )}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">{exercises.length} 个动作</span>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removePlan(plan.id);
                  }}
                  disabled={deletingId === plan.id}
                  className="text-zinc-600 transition-colors hover:text-zone-red disabled:opacity-40"
                  aria-label="删除该计划"
                  title="删除该计划"
                >
                  <Trash2 size={13} />
                </button>
              </span>
            </summary>
            <div className="mt-3 space-y-3">
              {plan.analysis_summary && (
                <div className="border-l-2 border-accent/70 pl-3">
                  <div className="mb-1 text-xs text-zinc-500">分析摘要</div>
                  <div className="text-sm text-zinc-300">{plan.analysis_summary}</div>
                </div>
              )}
              {plan.recovery_assessment && (
                <div className="border-l-2 border-zone-amber/70 pl-3">
                  <div className="mb-1 text-xs text-zinc-500">恢复评估</div>
                  <div className="text-sm text-zinc-300">{plan.recovery_assessment}</div>
                </div>
              )}
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
