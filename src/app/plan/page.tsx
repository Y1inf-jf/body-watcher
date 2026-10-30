"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { MessageSquarePlus } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import SegmentedTabs, { tabPanelProps } from "@/components/ui/SegmentedTabs";
import ChatPanel from "@/components/plan/ChatPanel";
import SessionList from "@/components/plan/SessionList";
import CoachNotes from "@/components/plan/CoachNotes";
import PlanArchive from "@/components/plan/PlanArchive";
import type { ChatMessage, ChatSession, CoachNote } from "@/components/plan/types";

// 右栏(桌面)/ 手机 tab 里的三个上下文面板。
type SideTab = "sessions" | "notes" | "plans";
type MobileView = "chat" | SideTab;

export default function PlanPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [notes, setNotes] = useState<CoachNote[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  // 纯 UI 状态:手机/平板当前视图、桌面右栏当前 tab。
  const [mobileView, setMobileView] = useState<MobileView>("chat");
  const [sideTab, setSideTab] = useState<SideTab>("sessions");
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

  // 打开会话的"最新请求"标记:响应回来只认最新一次点击,防止快速切换会话时
  // 旧响应后到覆盖新会话消息(否则追问会把 A 的内容写进 B 的会话)。
  const openRequestIdRef = useRef<number | null>(null);

  const openSession = useCallback((id: number) => {
    openRequestIdRef.current = id;
    fetch(`/api/chat?sessionId=${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (openRequestIdRef.current !== id) return;
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
        // 对话结束后:先等会话列表刷新,草稿卡无闪烁交棒给"当前对话面板";
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
    openRequestIdRef.current = null;
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

  // 历史条目点击 = 在对话区展开该会话(已展开时点击则收起;与草稿互斥)。
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

  // 草稿视图展示条件:正在新建,或尚无任何会话(首次引导)。
  const showComposer = composing || (historyLoaded && sessions.length === 0);
  // 当前展开的历史会话(列表里对应条目,取标题用)。
  const activeSession = sessions.find((s) => s.id === sessionId);
  // 正在查看某条已有会话;否则对话栏显示草稿视图(含 idle 状态)。
  const viewingSession = sessionId !== null && !showComposer;

  // 手机/平板:新建、打开历史会话后自动切回"对话"视图。
  const handleNewChat = () => {
    if (streaming) return;
    newChat();
    setMobileView("chat");
  };
  const handleToggle = (id: number) => {
    if (streaming) return;
    const opening = id !== sessionId;
    toggleSession(id);
    if (opening) setMobileView("chat");
  };

  // 面板可见性:手机按 mobileView,桌面(lg+)按 sideTab。
  const panelCls = (k: SideTab) =>
    `${mobileView === k ? "block" : "hidden"} ${sideTab === k ? "lg:block" : "lg:hidden"}`;

  const mobileTabs: { key: MobileView; label: string }[] = [
    { key: "chat", label: "对话" },
    { key: "sessions", label: `历史 ${sessions.length}` },
    { key: "notes", label: `笔记 ${notes.length}` },
    { key: "plans", label: "计划" },
  ];
  const sideTabs: { key: SideTab; label: string }[] = [
    { key: "sessions", label: `历史对话 ${sessions.length}` },
    { key: "notes", label: `教练笔记 ${notes.length}` },
    { key: "plans", label: "历史计划" },
  ];

  return (
    // lg 高度 = 100dvh − 顶栏 3.5rem − main pt-10(2.5rem) − main pb-16(4rem) − 1px 边;改 layout 内边距须同步
    <div className="lg:flex lg:h-[calc(100dvh-10rem-1px)] lg:min-h-[34rem] lg:flex-col">
      <PageHeader
        title="训练计划"
        description="和 AI 教练对话、存档计划，教练笔记会随每次对话带上"
        actions={
          <button onClick={handleNewChat} disabled={streaming} className="btn btn-primary">
            <MessageSquarePlus size={15} /> 新建对话
          </button>
        }
      />

      {/* 手机/平板:吸顶视图切换 */}
      <div className="sticky top-[calc(3rem+env(safe-area-inset-top))] z-20 -mx-4 mb-4 bg-bg/95 px-4 backdrop-blur md:top-14 md:-mx-6 md:px-6 lg:hidden">
        <SegmentedTabs idBase="plan-m" tabs={mobileTabs} value={mobileView} onChange={setMobileView} />
      </div>

      <div className="lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-12 lg:grid-rows-[minmax(0,1fr)]">
        <section
          {...tabPanelProps("plan-m", "chat")}
          className={`${mobileView === "chat" ? "flex" : "hidden"} min-w-0 flex-col lg:col-span-8 lg:flex lg:min-h-0 lg:pr-8`}
        >
          <ChatPanel
            viewing={viewingSession}
            title={activeSession?.title || "未命名对话"}
            streaming={streaming}
            messages={messages}
            bottomRef={bottomRef}
            input={input}
            onInputChange={setInput}
            onSend={send}
            onStop={() => abortRef.current?.abort()}
            onClose={closeConversation}
          />
        </section>

        <aside
          aria-label="对话上下文"
          className={`${mobileView === "chat" ? "hidden" : "block"} min-w-0 lg:col-span-4 lg:flex lg:min-h-0 lg:flex-col lg:border-l lg:border-line lg:pl-8`}
        >
          <div className="hidden shrink-0 lg:block">
            <SegmentedTabs idBase="plan-side" tabs={sideTabs} value={sideTab} onChange={setSideTab} />
          </div>
          <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
            {/* 外层手机 tab 面板,内层桌面 tab 面板:两组 tablist 的 aria-controls 都能对上 */}
            <div {...tabPanelProps("plan-m", "sessions")} className={panelCls("sessions")}>
              <div id="plan-side-panel-sessions" role="tabpanel" aria-labelledby="plan-side-tab-sessions">
                <SessionList
                  sessions={sessions}
                  activeId={showComposer ? null : sessionId}
                  streaming={streaming}
                  onToggle={handleToggle}
                  onRemove={removeSession}
                />
              </div>
            </div>
            <div {...tabPanelProps("plan-m", "notes")} className={panelCls("notes")}>
              <div id="plan-side-panel-notes" role="tabpanel" aria-labelledby="plan-side-tab-notes">
                <CoachNotes notes={notes} onChanged={fetchNotes} />
              </div>
            </div>
            <div {...tabPanelProps("plan-m", "plans")} className={panelCls("plans")}>
              <div id="plan-side-panel-plans" role="tabpanel" aria-labelledby="plan-side-tab-plans">
                <PlanArchive />
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
