"use client";

import { useState } from "react";
import { Pin, Plus, Trash2 } from "lucide-react";
import Tag from "@/components/ui/Tag";
import { isExpired, type CoachNote } from "./types";

// 教练笔记:长期记忆层,Agent 对话中也会自动写入;增删改后通过 onChanged 让页面刷新列表。
export default function CoachNotes({
  notes,
  onChanged,
}: {
  notes: CoachNote[];
  onChanged: () => void;
}) {
  const [noteInput, setNoteInput] = useState("");
  const [pinNew, setPinNew] = useState(false);

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
    onChanged();
  };

  const togglePin = async (n: CoachNote) => {
    await fetch("/api/coach-notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: n.id, pinned: n.pinned ? 0 : 1 }),
    });
    onChanged();
  };

  const deleteNote = async (id: number) => {
    await fetch(`/api/coach-notes?id=${id}`, { method: "DELETE" });
    onChanged();
  };

  return (
    <div className="@container">
      <p className="py-3 text-xs text-ink-3">教练笔记（{notes.length}）· 每次对话都会带上</p>

      <div className="flex flex-wrap items-center gap-2 pb-3">
        <input
          value={noteInput}
          onChange={(e) => setNoteInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addNote()}
          placeholder="手动添加一条,如:膝盖旧伤,避免深蹲"
          className="field min-w-0 flex-1 basis-full @md:basis-auto"
        />
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-ink-3">
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
          className="btn btn-secondary btn-sm"
        >
          <Plus size={13} /> 添加
        </button>
      </div>

      {notes.length === 0 && (
        <p className="text-xs text-ink-3">
          暂无。对话中告诉教练你的个人情况(伤病史/恢复规律/偏好),它会自动记下来;也可以在这里手动添加。
        </p>
      )}
      {notes.map((n) => (
        <div
          key={n.id}
          className="flex items-start justify-between gap-3 border-t border-line py-2.5 first:border-t-0"
        >
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
            {n.pinned === 1 && <Tag tone="red">硬约束</Tag>}
            <span className={isExpired(n.expires_at) ? "text-ink-4 line-through" : ""}>{n.content}</span>
            {n.expires_at && (
              <span className="shrink-0 font-mono text-[11px] text-ink-3">
                {isExpired(n.expires_at) ? "已过期" : `至 ${n.expires_at}`}
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <span className="hidden font-mono text-[11px] text-ink-3 @lg:inline">{n.created_at}</span>
            <button
              onClick={() => togglePin(n)}
              className={`grid h-8 w-8 place-items-center rounded-md hover:bg-surface-2 ${
                n.pinned ? "text-zone-red" : "text-ink-3 transition-colors hover:text-ink"
              }`}
              aria-label={n.pinned ? "取消硬约束" : "置顶为硬约束"}
            >
              <Pin size={14} />
            </button>
            <button
              onClick={() => deleteNote(n.id)}
              className="grid h-8 w-8 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-zone-red"
              aria-label="删除笔记"
            >
              <Trash2 size={14} />
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
