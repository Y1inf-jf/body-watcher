"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

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
    <div className="animate-fade-up">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-ink">训练日历</h3>
        {error && <span className="text-xs text-zone-red">{error}</span>}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={prevMonth} className="btn btn-ghost btn-sm" aria-label="上个月">
            <ChevronLeft size={16} />
          </button>
          <span className="w-24 text-center font-mono text-sm text-ink">{year}年{month}月</span>
          <button onClick={nextMonth} className="btn btn-ghost btn-sm" aria-label="下个月">
            <ChevronRight size={16} />
          </button>
          <span className="ml-2 text-xs text-ink-3">{trainedCount}天训练 {restCount}天休息</span>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
          <div key={d} className="py-1 text-center text-xs text-ink-3">{d}</div>
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
              className={`flex min-h-[2.75rem] flex-col items-center justify-start rounded-md pt-1 text-center text-xs transition-colors hover:bg-surface-2 sm:min-h-[3rem] ${
                cell ? "bg-ink/10" : ""
              } ${isCurrentDay ? "ring-1 ring-inset ring-ink-3" : ""}`}
            >
              <span
                className={
                  cell ? "font-medium text-ink"
                    : isRest ? "font-medium text-accent"
                    : isCurrentDay ? "text-ink-2"
                    : "text-ink-4"
                }
              >
                {dayNum}
              </span>
              {cell && (
                <span className="mt-0.5 hidden text-[10px] leading-tight text-ink-2 sm:block">
                  {cell.muscle_groups.split(",").slice(0, 2).join(",")}
                </span>
              )}
              {isRest && !cell && (
                <span className="mt-0.5 hidden text-[10px] text-accent sm:block">休息</span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <input
          type="date"
          value={restDate}
          onChange={(e) => {
            setRestDate(e.target.value);
            setRestMsg("");
          }}
          className="field py-1.5"
        />
        <button
          onClick={toggleRestDay}
          disabled={busy || !restDate}
          className="btn btn-secondary btn-sm"
        >
          {busy ? "保存中..." : isMarked ? "取消此日休息标记" : "标记为休息日"}
        </button>
        <span className="text-xs text-ink-3">可选任意日期补标/撤销</span>
        {hasTraining && isMarked === false && (
          <span className="text-xs text-zone-amber">该日已有训练记录</span>
        )}
        {restMsg && <span className="text-xs text-accent">{restMsg}</span>}
      </div>
    </div>
  );
}
