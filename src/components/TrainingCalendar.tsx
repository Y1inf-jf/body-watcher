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
  const [restDate, setRestDate] = useState(new Date().toISOString().split("T")[0]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/training?calendar=1&year=${year}&month=${month}`)
      .then((r) => r.json())
      .then((d) => {
        setDays(d.calendar || []);
        setRestDays((d.restDays || []).map((r: { date: string }) => r.date));
      })
      .catch(() => setError("加载日历数据失败"));
  }, [year, month]);

  const dayMap = new Map<string, CalendarDay>();
  for (const d of days) dayMap.set(d.date, d);

  const restSet = new Set(restDays);

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

  const markRestDay = async () => {
    await fetch("/api/health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: restDate, rest_day: 1 }),
    });
    if (year === new Date(parseInt(restDate.slice(0, 4)), parseInt(restDate.slice(5, 7)) - 1).getFullYear() &&
        month === parseInt(restDate.slice(5, 7))) {
      setRestDays((prev) => [...prev, restDate]);
    }
  };

  const trainedCount = days.length;
  const restCount = restDays.filter((d) => {
    const m = parseInt(d.slice(5, 7));
    return parseInt(d.slice(0, 4)) === year && m === month;
  }).length;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-zinc-400">训练日历</h3>
        {error && <span className="text-xs text-red-400">{error}</span>}
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
                  ? "bg-green-900/40 border border-green-800/50"
                  : isRest
                  ? "bg-blue-900/30 border border-blue-800/40"
                  : isCurrentDay
                  ? "border border-zinc-600"
                  : ""
              }`}
            >
              <span className={
                cell ? "text-green-300 font-medium"
                  : isRest ? "text-blue-300 font-medium"
                  : isCurrentDay ? "text-zinc-300"
                  : "text-zinc-600"
              }>
                {dayNum}
              </span>
              {cell && (
                <span className="text-[10px] text-green-500 mt-0.5 leading-tight">
                  {cell.muscle_groups.split(",").slice(0, 2).join(",")}
                </span>
              )}
              {isRest && !cell && (
                <span className="text-[10px] text-blue-500 mt-0.5">休息</span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-zinc-800">
        <input
          type="date"
          value={restDate}
          onChange={(e) => setRestDate(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs"
        />
        <button onClick={markRestDay} className="text-xs bg-blue-900/50 text-blue-300 hover:bg-blue-900 px-2 py-1 rounded">
          标记休息日
        </button>
      </div>
    </div>
  );
}
