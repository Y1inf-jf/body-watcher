"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Card, CardTitle } from "@/components/ui/Card";

interface SleepTargets {
  minMinutes: number | null;
  targetMinutes: number | null;
  idealMinutes: number | null;
}

type FieldState = { h: string; m: string };
const emptyField = (): FieldState => ({ h: "", m: "" });

const ROWS: { key: keyof SleepTargets; title: string; desc: string }[] = [
  { key: "minMinutes", title: "最低", desc: "实际睡眠跌破这条线即算睡眠债，拖累恢复分与今日建议" },
  { key: "targetMinutes", title: "目标", desc: "今晚建议时长不会低于这个数" },
  { key: "idealMinutes", title: "理想", desc: "今晚建议的封顶——不鼓励一次补爆" },
];

function toField(minutes: number | null): FieldState {
  if (minutes === null) return emptyField();
  return { h: String(Math.floor(minutes / 60)), m: String(minutes % 60) };
}

// null=留空未设;undefined=输入非法
function fromField(f: FieldState): number | null | undefined {
  if (f.h.trim() === "" && f.m.trim() === "") return null;
  const h = Number(f.h || 0);
  const m = Number(f.m || 0);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 12 || m < 0 || m > 59) return undefined;
  return h * 60 + m;
}

const INPUT_CLS = "w-14 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-center tabular-nums";

export default function SettingsPage() {
  const [fields, setFields] = useState<Record<keyof SleepTargets, FieldState>>({
    minMinutes: emptyField(),
    targetMinutes: emptyField(),
    idealMinutes: emptyField(),
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { sleepTargets: SleepTargets };
        setFields({
          minMinutes: toField(json.sleepTargets.minMinutes),
          targetMinutes: toField(json.sleepTargets.targetMinutes),
          idealMinutes: toField(json.sleepTargets.idealMinutes),
        });
      } catch {
        setBanner({ kind: "err", text: "读取设置失败，请刷新重试" });
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const onSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setBanner(null);
    const minutes = {} as SleepTargets;
    for (const { key } of ROWS) {
      const v = fromField(fields[key]);
      if (v === undefined) {
        setBanner({ kind: "err", text: "时长格式不对：小时 0-12、分钟 0-59，或整行留空" });
        return;
      }
      minutes[key] = v;
    }
    const order = [minutes.minMinutes, minutes.targetMinutes, minutes.idealMinutes].filter(
      (v): v is number => v !== null
    );
    for (let i = 1; i < order.length; i++) {
      if (order[i] < order[i - 1]) {
        setBanner({ kind: "err", text: "三档需满足 最低 ≤ 目标 ≤ 理想" });
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sleepTargets: minutes }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setBanner({ kind: "err", text: json.error ?? "保存失败" });
      } else {
        setBanner({ kind: "ok", text: "已保存，总览与教练即刻采用新目标" });
      }
    } catch {
      setBanner({ kind: "err", text: "网络错误，未保存" });
    } finally {
      setSaving(false);
    }
  }, [fields]);

  return (
    <div className="max-w-2xl space-y-4">
      <h2 className="text-xl font-bold">设置</h2>

      {banner && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            banner.kind === "ok"
              ? "border-zone-green/40 bg-zone-green/10 text-zone-green"
              : "border-zone-red/40 bg-zone-red/10 text-zone-red"
          }`}
        >
          {banner.text}
        </div>
      )}

      <Card className="p-5">
        <CardTitle>Sleep Targets · 睡眠目标</CardTitle>
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">
          不设目标时，系统拿“你近 7 晚的实际均值”衡量睡眠债——连日缺觉会把均值拉低，越缺越显得正常。
          设了目标后，参照线取<span className="text-zinc-300">目标与均值里较高的</span>，目标就是你的底线，不会被自己的坏习惯向下兼容。
        </p>

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          {ROWS.map(({ key, title, desc }) => (
            <div key={key} className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <div className="w-16 shrink-0 text-sm font-medium text-zinc-200">{title}</div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={12}
                  inputMode="numeric"
                  placeholder="时"
                  className={INPUT_CLS}
                  value={fields[key].h}
                  disabled={!loaded}
                  onChange={(e) => setFields((f) => ({ ...f, [key]: { ...f[key], h: e.target.value } }))}
                />
                <span className="text-xs text-zinc-500">h</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  inputMode="numeric"
                  placeholder="分"
                  className={INPUT_CLS}
                  value={fields[key].m}
                  disabled={!loaded}
                  onChange={(e) => setFields((f) => ({ ...f, [key]: { ...f[key], m: e.target.value } }))}
                />
                <span className="text-xs text-zinc-500">min</span>
              </div>
              <div className="min-w-0 flex-1 basis-48 text-[11px] text-zinc-500">{desc}</div>
            </div>
          ))}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={!loaded || saving}
              className="rounded-lg bg-accent/90 px-4 py-1.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-accent disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存"}
            </button>
            <span className="text-[11px] text-zinc-600">全部留空 = 不设目标，回到纯历史均值口径</span>
          </div>
        </form>
      </Card>
    </div>
  );
}
