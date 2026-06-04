"use client";

import { useState, useEffect } from "react";

interface HealthData {
  date: string;
  hrv: string;
  resting_hr: string;
  systolic: string;
  diastolic: string;
  sleep_hours: string;
  sleep_quality: string;
  weight: string;
  body_fat: string;
  rpe: string;
  notes: string;
}

const defaultData: HealthData = {
  date: new Date().toISOString().split("T")[0],
  hrv: "",
  resting_hr: "",
  systolic: "",
  diastolic: "",
  sleep_hours: "",
  sleep_quality: "",
  weight: "",
  body_fat: "",
  rpe: "",
  notes: "",
};

export default function HealthForm() {
  const [data, setData] = useState<HealthData>(defaultData);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/health?days=1")
      .then((r) => r.json())
      .then((res) => {
        if (res.latest) {
          const l = res.latest as Record<string, unknown>;
          setData((prev) => ({
            ...prev,
            weight: l.weight ? String(l.weight) : prev.weight,
            body_fat: l.body_fat ? String(l.body_fat) : prev.body_fat,
          }));
        }
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    const body: Record<string, unknown> = { date: data.date };
    const fields = ["hrv", "resting_hr", "systolic", "diastolic", "sleep_hours", "sleep_quality", "weight", "body_fat", "rpe"] as const;
    for (const f of fields) {
      if (data[f]) body[f] = parseFloat(data[f]);
    }
    if (data.notes) body.notes = data.notes;

    const res = await fetch("/api/health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setSaving(false);
    if (res.ok) {
      setMessage("已保存");
      setTimeout(() => setMessage(""), 2000);
    } else {
      setMessage("保存失败");
    }
  };

  const fields = [
    { key: "hrv", label: "HRV (ms)", placeholder: "45" },
    { key: "resting_hr", label: "静息心率", placeholder: "62" },
    { key: "systolic", label: "收缩压", placeholder: "120" },
    { key: "diastolic", label: "舒张压", placeholder: "80" },
    { key: "sleep_hours", label: "睡眠 (h)", placeholder: "7.5" },
    { key: "sleep_quality", label: "睡眠质量 (1-10)", placeholder: "7" },
    { key: "weight", label: "体重 (kg)", placeholder: "75" },
    { key: "body_fat", label: "体脂 (%)", placeholder: "15" },
    { key: "rpe", label: "疲劳感 (1-10)", placeholder: "5" },
  ] as const;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center gap-4">
        <input
          type="date"
          value={data.date}
          onChange={(e) => setData({ ...data, date: e.target.value })}
          className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-1.5 rounded text-sm font-medium"
        >
          {saving ? "保存中..." : "保存"}
        </button>
        {message && <span className="text-sm text-green-400">{message}</span>}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {fields.map(({ key, label, placeholder }) => (
          <div key={key}>
            <label className="block text-xs text-zinc-400 mb-1">{label}</label>
            <input
              type="number"
              step="any"
              placeholder={placeholder}
              value={data[key]}
              onChange={(e) => setData({ ...data, [key]: e.target.value })}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm"
            />
          </div>
        ))}
      </div>
      <div>
        <label className="block text-xs text-zinc-400 mb-1">备注</label>
        <input
          type="text"
          value={data.notes}
          onChange={(e) => setData({ ...data, notes: e.target.value })}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm"
          placeholder="今天状态如何..."
        />
      </div>
    </form>
  );
}
