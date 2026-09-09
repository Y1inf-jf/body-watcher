"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface CalendarDay {
  log_id: number;
  date: string;
  muscle_groups: string;
  exercise_count: number;
}

export default function TrainingCalendar() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [restDays, setRestDays] = useState<string[]>([]);
  // toISOString 是 UTC,早八点前会取到昨天;用本地日期口径(与全库一致)。
  const localToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const [restDate, setRestDate] = useState(localToday);
  const [busy, setBusy] = useState(false);
  const [restMsg, setRestMsg] = useState("");
  const [error, setError] = useState("");

  const load = (y: number, m: number) => {
    fetch(`/api/training?calendar=1&year=${y}&month=${m}`)
      .then((r) => r.json())
      .then((d) => {
        setDays(d.calendar || []);
        setRestDays((d.restDays || []).map((r: { date: string }) => r.date));
      })
      .catch(() => setError("加载日历数据失败"));
  };

  useEffect(() => {
    load(year, month);
  }, [year, month]);

  const dayMap = new Map<string, CalendarDay>();
  for (const d of days) dayMap.set(d.date, d);

  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (CalendarDay | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push(dayMap.get(dateStr) || null);
  }

  const prevMonth = () => {
    if (month === 1) { setYear(year - 1); setMonth(12); }
    else setMonth(month - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(year + 1); setMonth(1); }
    else setMonth(month + 1);
  };

  // 任意日期可标可取消:标记往前的补录、点错的撤销都走这一个开关。
  const restSet = new Set(restDays);
  const isMarked = restSet.has(restDate);
  const hasTraining = days.some((d) => d.date === restDate);

  const toggleRestDay = async () => {
    if (!restDate || busy) return;
    setBusy(true);
    setRestMsg("");
    try {
      const res = await fetch("/api/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: restDate, rest_day: isMarked ? 0 : 1 }),
      });
      if (!res.ok) {
        setRestMsg("保存失败,请重试");
        return;
      }
      load(year, month);
      setRestMsg(isMarked ? `已取消 ${restDate} 的休息标记` : `已标记 ${restDate} 为休息日`);
    } catch {
      setRestMsg("网络错误,未保存");
    } finally {
      setBusy(false);
    }
  };

  const trainedCount = days.length;
  const restCount = restDays.filter((d) => {
    const m = parseInt(d.slice(5, 7));
    return parseInt(d.slice(0, 4)) === year && m === month;
  }).length;

  return (
    <div className="panel animate-fade-up p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">Training Calendar · 训练日历</h3>
        {error && <span className="text-xs text-zone-red">{error}</span>}
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="text-zinc-500 hover:text-zinc-300 text-sm px-1">&lt;</button>
          <span className="text-sm text-zinc-300 w-24 text-center">{year}年{month}月</span>
          <button onClick={nextMonth} className="text-zinc-500 hover:text-zinc-300 text-sm px-1">&gt;</button>
          <span className="text-xs text-zinc-600 ml-2">{trainedCount}天训练 {restCount}天休息</span>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
          <div key={d} className="text-xs text-zinc-600 text-center py-1">{d}</div>
        ))}
        {cells.map((cell, i) => {
          const dayNum = i - firstDay + 1;

          if (!cell && (dayNum < 1 || dayNum > daysInMonth)) {
            return <div key={i} />;
          }

          const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
          const isRest = restSet.has(dateStr);
          const isCurrentDay = year === now.getFullYear() && month === now.getMonth() + 1 && dayNum === now.getDate();

          return (
            <Link
              key={i}
              href={cell ? `/input?edit=${cell.log_id}` : `/input?date=${dateStr}`}
              className={`text-center py-1 rounded text-xs min-h-[3rem] flex flex-col items-center justify-start pt-1 cursor-pointer hover:brightness-125 transition ${
                cell
                  ? "bg-zone-green/15 border border-zone-green/30"
                  : isRest
                  ? "bg-accent/10 border border-accent/25"
                  : isCurrentDay
                  ? "border border-white/25"
                  : ""
              }`}
            >
              <span className={
                cell ? "text-zone-green font-medium"
                  : isRest ? "text-accent font-medium"
                  : isCurrentDay ? "text-zinc-300"
                  : "text-zinc-600"
              }>
                {dayNum}
              </span>
              {cell && (
                <span className="text-[10px] text-zone-green/70 mt-0.5 leading-tight">
                  {cell.muscle_groups.split(",").slice(0, 2).join(",")}
                </span>
              )}
              {isRest && !cell && (
                <span className="text-[10px] text-accent/80 mt-0.5">休息</span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3 pt-2 border-t border-white/5">
        <input
          type="date"
          value={restDate}
          onChange={(e) => {
            setRestDate(e.target.value);
            setRestMsg("");
          }}
          className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-zinc-200 [color-scheme:dark]"
        />
        <button
          onClick={toggleRestDay}
          disabled={busy || !restDate}
          className={
            isMarked
              ? "text-xs rounded border border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10 px-2 py-1 transition-colors disabled:opacity-40"
              : "text-xs rounded border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 px-2 py-1 transition-colors disabled:opacity-40"
          }
        >
          {busy ? "保存中..." : isMarked ? "取消此日休息标记" : "标记为休息日"}
        </button>
        <span className="text-[11px] text-zinc-600">可选任意日期补标/撤销</span>
        {hasTraining && isMarked === false && (
          <span className="text-[11px] text-zone-amber/80">该日已有训练记录</span>
        )}
        {restMsg && <span className="text-[11px] text-accent/80">{restMsg}</span>}
      </div>
    </div>
  );
}
