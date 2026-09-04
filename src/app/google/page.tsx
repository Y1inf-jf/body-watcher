"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface SyncLogRow {
  started_at?: string;
  finished_at?: string;
  status?: string;
  message?: string | null;
  types_synced?: string | null;
}

interface MetricsRow {
  date: string;
  sleep_in_bed_minutes?: number | null;
  sleep_deep_minutes?: number | null;
  sleep_rem_minutes?: number | null;
  sleep_bedtime?: string | null;
  sleep_wakeup?: string | null;
  hrv_rmssd_deep_ms?: number | null;
  resting_hr?: number | null;
  steps?: number | null;
  weight_kg?: number | null;
  exercise_minutes?: number | null;
}

interface StatusData {
  configured: boolean;
  connected: boolean;
  expiresAt?: number | null;
  lastSync?: SyncLogRow | null;
  todayCounts: { data_type: string; points: number }[];
  metrics: MetricsRow[];
}

const TYPE_LABELS: Record<string, string> = {
  sleep: "睡眠",
  steps: "步数",
  exercise: "运动",
  weight: "体重",
  "daily-heart-rate-variability": "HRV",
  "daily-resting-heart-rate": "静息心率",
  "daily-respiratory-rate": "呼吸率",
  "daily-oxygen-saturation": "血氧",
};

function fmtTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { hour12: false });
}

function fmtDuration(min?: number | null): string {
  if (min === null || min === undefined) return "—";
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}m`;
}

export default function GoogleSyncPage() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/google/status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus((await res.json()) as StatusData);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      await load();
      if (cancelled) return;
      // 授权回跳的结果提示只读一次
      if (params.get("connected")) setBanner({ kind: "ok", text: "Google Health 连接成功" });
      const err = params.get("error");
      if (err) setBanner({ kind: "err", text: err });
    })();
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  // 同步进行中时轮询状态（自动同步可能由 instrumentation 触发）
  useEffect(() => {
    const running = status?.lastSync?.status === "running";
    if (running && !pollRef.current) {
      pollRef.current = setInterval(load, 3000);
    } else if (!running && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [status?.lastSync?.status, load]);

  async function syncNow() {
    setSyncing(true);
    try {
      const res = await fetch("/api/google/sync", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setBanner({ kind: "err", text: `同步失败：${(body.errors as string[] | undefined)?.join("；") ?? res.status}` });
      } else if (body.status === "partial") {
        setBanner({ kind: "err", text: `部分成功：${(body.errors as string[]).join("；")}` });
      } else {
        setBanner({ kind: "ok", text: "同步完成" });
      }
    } catch (err) {
      setBanner({ kind: "err", text: `同步请求失败：${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSyncing(false);
      load();
    }
  }

  async function disconnect() {
    if (!confirm("断开后将删除本地 token，需要重新授权才能同步，确定？")) return;
    await fetch("/api/google/connection", { method: "DELETE" });
    setBanner({ kind: "ok", text: "已断开连接" });
    load();
  }

  const running = status?.lastSync?.status === "running";

  return (
    <div className="space-y-4 max-w-3xl">
      <h2 className="text-xl font-bold text-zinc-100">数据同步 · Google Health</h2>
      <p className="text-sm text-zinc-500 -mt-2">
        Fitbit Air → Google Health App → 云端 → 本应用。数据链路与踩坑记录见 docs/google-health-spike.md。
      </p>

      {banner && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${banner.kind === "ok" ? "border-green-800 bg-green-950/50 text-green-300" : "border-red-800 bg-red-950/50 text-red-300"}`}>
          {banner.text}
        </div>
      )}
      {loadError && (
        <div className="rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
          状态加载失败：{loadError}
        </div>
      )}

      {/* 连接状态卡 */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-zinc-100">连接状态</h3>
            {status === null ? (
              <p className="text-sm text-zinc-500 mt-1">加载中…</p>
            ) : !status.configured ? (
              <p className="text-sm text-amber-400 mt-1">
                .env 缺少 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET，参考 .env.example 配置后重启。
              </p>
            ) : status.connected ? (
              <p className="text-sm text-zinc-400 mt-1">
                已连接，token 至 {status.expiresAt ? new Date(status.expiresAt).toLocaleString("zh-CN", { hour12: false }) : "—"} 前有效（到期自动刷新）
              </p>
            ) : (
              <p className="text-sm text-zinc-400 mt-1">未连接。授权时请使用手机 Google Health App 同款的 Google 账号。</p>
            )}
          </div>
          {status?.connected ? (
            <div className="flex gap-2">
              <button
                onClick={syncNow}
                disabled={syncing || running}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-2 rounded text-sm font-medium text-white"
              >
                {syncing || running ? "同步中…" : "立即同步"}
              </button>
              <button
                onClick={disconnect}
                className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-1.5 rounded text-xs text-zinc-300"
              >
                断开
              </button>
            </div>
          ) : (
            status?.configured && (
              <a
                href="/api/google/auth"
                className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm font-medium text-white"
              >
                连接 Google Health
              </a>
            )
          )}
        </div>
        {running && <p className="text-xs text-zinc-500 mt-2">一次同步正在进行中，完成后本页自动刷新…</p>}
      </div>

      {/* 上次同步 */}
      {status?.lastSync && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h3 className="font-medium text-zinc-100">上次同步</h3>
          <div className="text-sm text-zinc-400 mt-2 space-y-1">
            <p>
              状态：
              <span
                className={
                  status.lastSync.status === "success"
                    ? "text-green-400"
                    : status.lastSync.status === "partial"
                      ? "text-amber-400"
                      : status.lastSync.status === "running"
                        ? "text-blue-400"
                        : "text-red-400"
                }
              >
                {status.lastSync.status}
              </span>
              <span className="text-zinc-500"> · 结束于 {fmtTime(status.lastSync.finished_at)}</span>
            </p>
            {status.lastSync.message && <p className="text-red-400 break-all">{status.lastSync.message}</p>}
          </div>
        </div>
      )}

      {/* 今日拉到的数据量 */}
      {status && status.todayCounts.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h3 className="font-medium text-zinc-100">今日数据点</h3>
          <div className="flex flex-wrap gap-2 mt-2">
            {status.todayCounts.map(({ data_type, points }) => (
              <span key={data_type} className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300">
                {TYPE_LABELS[data_type] ?? data_type}: {points}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 最近 7 天汇总 */}
      {status && status.metrics.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 overflow-x-auto">
          <h3 className="font-medium text-zinc-100 mb-2">最近 7 天（Google Health）</h3>
          <table className="w-full text-xs text-zinc-300">
            <thead>
              <tr className="text-left text-zinc-500 border-b border-zinc-800">
                <th className="py-1.5 pr-3">日期</th>
                <th className="py-1.5 pr-3">就枕-起床</th>
                <th className="py-1.5 pr-3">在床</th>
                <th className="py-1.5 pr-3">深睡</th>
                <th className="py-1.5 pr-3">REM</th>
                <th className="py-1.5 pr-3">HRV rMSSD</th>
                <th className="py-1.5 pr-3">静息心率</th>
                <th className="py-1.5 pr-3">步数</th>
                <th className="py-1.5 pr-3">体重kg</th>
                <th className="py-1.5">运动min</th>
              </tr>
            </thead>
            <tbody>
              {status.metrics.map((m) => (
                <tr key={m.date} className="border-b border-zinc-800/50">
                  <td className="py-1.5 pr-3">{m.date}</td>
                  <td className="py-1.5 pr-3">{m.sleep_bedtime && m.sleep_wakeup ? `${m.sleep_bedtime}-${m.sleep_wakeup}` : "—"}</td>
                  <td className="py-1.5 pr-3">{fmtDuration(m.sleep_in_bed_minutes)}</td>
                  <td className="py-1.5 pr-3">{fmtDuration(m.sleep_deep_minutes)}</td>
                  <td className="py-1.5 pr-3">{fmtDuration(m.sleep_rem_minutes)}</td>
                  <td className="py-1.5 pr-3">{m.hrv_rmssd_deep_ms ?? "—"}</td>
                  <td className="py-1.5 pr-3">{m.resting_hr ?? "—"}</td>
                  <td className="py-1.5 pr-3">{m.steps ?? "—"}</td>
                  <td className="py-1.5 pr-3">{m.weight_kg ?? "—"}</td>
                  <td className="py-1.5">{m.exercise_minutes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {status && status.connected && status.metrics.length === 0 && status.todayCounts.length === 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-sm text-zinc-400">
          已连接但还没有数据。确认手环已通过手机 Google Health App 同步上云后点“立即同步”。
        </div>
      )}
    </div>
  );
}
