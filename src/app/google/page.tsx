"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Section from "@/components/ui/Section";
import Notice from "@/components/ui/Notice";
import Stat from "@/components/ui/Stat";
import Tag from "@/components/ui/Tag";
import Disclosure from "@/components/ui/Disclosure";

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
  hrv_avg_ms?: number | null;
  hrv_rmssd_deep_ms?: number | null;
  resting_hr?: number | null;
  respiratory_rate?: number | null;
  spo2_avg?: number | null;
  temp_night_c?: number | null;
  temp_baseline_c?: number | null;
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
  "daily-sleep-temperature-derivations": "睡眠体温",
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

interface XunjiInfo {
  configured: boolean;
  datesFetched: number;
  latest?: { datestr: string; trains_found: number; fetched_at: string };
}

// 7 天表的行定义（转置后每行一个指标）；取值/格式化与原按日期行表达式一致
const METRIC_ROWS: { label: string; render: (m: MetricsRow) => ReactNode }[] = [
  { label: "就枕-起床", render: (m) => (m.sleep_bedtime && m.sleep_wakeup ? `${m.sleep_bedtime}-${m.sleep_wakeup}` : "—") },
  { label: "在床", render: (m) => fmtDuration(m.sleep_in_bed_minutes) },
  { label: "深睡", render: (m) => fmtDuration(m.sleep_deep_minutes) },
  { label: "REM", render: (m) => fmtDuration(m.sleep_rem_minutes) },
  { label: "HRV均值", render: (m) => m.hrv_avg_ms ?? "—" },
  { label: "深睡RMSSD", render: (m) => m.hrv_rmssd_deep_ms ?? "—" },
  { label: "静息心率", render: (m) => m.resting_hr ?? "—" },
  { label: "呼吸率", render: (m) => m.respiratory_rate ?? "—" },
  { label: "血氧%", render: (m) => m.spo2_avg ?? "—" },
  {
    label: "体温°C(Δ基线)",
    render: (m) =>
      m.temp_night_c != null
        ? `${m.temp_night_c.toFixed(1)}${
            m.temp_baseline_c != null
              ? ` (${m.temp_night_c - m.temp_baseline_c >= 0 ? "+" : ""}${(m.temp_night_c - m.temp_baseline_c).toFixed(1)})`
              : ""
          }`
        : "—",
  },
  { label: "步数", render: (m) => m.steps ?? "—" },
  { label: "体重kg", render: (m) => m.weight_kg ?? "—" },
  { label: "运动min", render: (m) => m.exercise_minutes ?? "—" },
];

export default function GoogleSyncPage() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [xunjiInfo, setXunjiInfo] = useState<XunjiInfo | null>(null);
  const [xjSyncing, setXjSyncing] = useState(false);
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

  const loadXunji = useCallback(async () => {
    try {
      const res = await fetch("/api/xunji/sync");
      if (res.ok) setXunjiInfo((await res.json()) as XunjiInfo);
    } catch {
      // 训记状态加载失败不阻塞页面其余部分
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      await load();
      await loadXunji();
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
  }, [load, loadXunji]);

  async function syncXunji(force: boolean) {
    setXjSyncing(true);
    try {
      const res = await fetch(`/api/xunji/sync${force ? "?force=1&days=31" : ""}`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setBanner({ kind: "err", text: `训记同步失败：${(body.errors as string[] | undefined)?.join("；") ?? res.status}` });
      } else {
        setBanner({ kind: "ok", text: `训记同步完成：新增 ${body.created} 条、更新 ${body.updated} 条${body.skippedHealthMirrors ? `、跳过健康回灌 ${body.skippedHealthMirrors} 条` : ""}` });
      }
    } catch (err) {
      setBanner({ kind: "err", text: `训记同步请求失败：${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setXjSyncing(false);
      loadXunji();
    }
  }

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

  // 状态标签：Google Health / 训记 的连接状态，以及上次同步状态着色
  const gTag =
    status === null ? (
      <Tag tone="neutral">加载中</Tag>
    ) : !status.configured ? (
      <Tag tone="amber">未配置</Tag>
    ) : status.connected ? (
      <Tag tone="green">已连接</Tag>
    ) : (
      <Tag tone="neutral">未连接</Tag>
    );
  const xTag =
    xunjiInfo === null ? (
      <Tag tone="neutral">加载中</Tag>
    ) : !xunjiInfo.configured ? (
      <Tag tone="amber">未配置</Tag>
    ) : (
      <Tag tone="green">已配置</Tag>
    );
  const lastStatus = status?.lastSync?.status;
  const lastTone =
    lastStatus === "success" ? "green" : lastStatus === "partial" ? "amber" : lastStatus === "running" ? "accent" : "red";

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="数据同步" description="Google Health 与训记的连接状态和最近同步结果" />

      {banner && (
        <Notice tone={banner.kind} className="mb-6">
          {banner.text}
        </Notice>
      )}
      {loadError && (
        <Notice tone="err" className="mb-6">
          状态加载失败：{loadError}
        </Notice>
      )}

      {/* 同步状态：三格并排（窄屏堆叠） */}
      <section aria-label="同步状态" className="grid border-b border-line md:grid-cols-2 lg:grid-cols-3">
        {/* 格 1：Google Health 连接与上次同步 */}
        <div className="flex min-w-0 flex-col py-6 md:pr-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-ink">
              <span className="mr-2 font-mono text-[11px] text-ink-3">01</span>Google Health
            </h2>
            {gTag}
          </div>
          <div className="mt-5">
            <Stat
              label="上次同步"
              value={fmtTime(status?.lastSync?.finished_at)}
              sub={status?.lastSync?.status ? <Tag tone={lastTone}>{status.lastSync.status}</Tag> : undefined}
            />
          </div>
          <div className="mt-3 text-xs">
            {status === null ? (
              <p className="text-ink-3">加载中…</p>
            ) : !status.configured ? (
              <p className="text-zone-amber">
                .env 缺少 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET，参考 .env.example 配置后重启。
              </p>
            ) : status.connected ? (
              <p className="text-ink-2">
                已连接，token 至 {status.expiresAt ? new Date(status.expiresAt).toLocaleString("zh-CN", { hour12: false }) : "—"} 前有效（到期自动刷新）
              </p>
            ) : (
              <p className="text-ink-2">未连接。授权时请使用手机 Google Health App 同款的 Google 账号。</p>
            )}
          </div>
          {status?.lastSync?.message && (
            <p className="mt-2 break-all text-xs text-zone-red">{status.lastSync.message}</p>
          )}
          {running && <p className="mt-2 text-xs text-ink-3">一次同步正在进行中，完成后本页自动刷新…</p>}
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
            {status?.connected ? (
              <>
                <button onClick={syncNow} disabled={syncing || running} className="btn btn-primary">
                  {syncing || running ? "同步中…" : "立即同步"}
                </button>
                <button onClick={disconnect} className="btn btn-secondary btn-sm">
                  断开
                </button>
              </>
            ) : (
              status?.configured && (
                <a href="/api/google/auth" className="btn btn-primary">
                  连接 Google Health
                </a>
              )
            )}
          </div>
        </div>

        {/* 格 2：训记训练记录 */}
        <div className="flex min-w-0 flex-col border-t border-line py-6 md:border-t-0 md:border-l md:pl-6 lg:pr-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-ink">
              <span className="mr-2 font-mono text-[11px] text-ink-3">02</span>训练记录(训记)
            </h2>
            {xTag}
          </div>
          <div className="mt-5">
            {xunjiInfo === null ? (
              <p className="text-sm text-ink-3">加载中…</p>
            ) : !xunjiInfo.configured ? (
              <p className="text-sm text-zone-amber">.env 缺少 XUNJI_API_KEY,在训记 App 内申请后填入。</p>
            ) : (
              <>
                <Stat
                  label="已拉取"
                  value={xunjiInfo.datesFetched}
                  unit="天"
                  sub={
                    xunjiInfo.latest &&
                    `最近 ${xunjiInfo.latest.datestr}(发现 ${xunjiInfo.latest.trains_found} 条训练)`
                  }
                />
                {xunjiInfo.latest && (
                  <p className="mt-2 text-xs text-ink-3">最近拉取 {fmtTime(xunjiInfo.latest.fetched_at)}</p>
                )}
              </>
            )}
          </div>
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
            {xunjiInfo?.configured && (
              <>
                <button onClick={() => syncXunji(false)} disabled={xjSyncing} className="btn btn-secondary">
                  {xjSyncing ? "同步中…" : "同步最近 7 天"}
                </button>
                <button onClick={() => syncXunji(true)} disabled={xjSyncing} className="btn btn-ghost btn-sm">
                  强刷 31 天
                </button>
              </>
            )}
          </div>
        </div>

        {/* 格 3：今日数据点 */}
        <div className="min-w-0 border-t border-line py-6 md:col-span-2 lg:col-span-1 lg:border-t-0 lg:border-l lg:pl-6">
          <h2 className="text-sm font-medium text-ink">
            <span className="mr-2 font-mono text-[11px] text-ink-3">03</span>今日数据点
          </h2>
          {status && status.todayCounts.length > 0 ? (
            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4 lg:grid-cols-2">
              {status.todayCounts.map(({ data_type, points }) => (
                <div key={data_type} className="flex items-baseline justify-between gap-2">
                  <dt className="text-xs text-ink-3">{TYPE_LABELS[data_type] ?? data_type}</dt>
                  <dd className="font-mono text-sm tabular-nums text-ink">{points}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-5 text-sm text-ink-3">—</p>
          )}
        </div>
      </section>

      {/* 最近 7 天汇总（转置：行为指标，列为日期，左起最新） */}
      {status && status.metrics.length > 0 && (
        <Section
          index="04"
          title="最近 7 天（Google Health）"
          aside={<span className="text-xs text-ink-3">左起为最新</span>}
          className="pt-10"
        >
          <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
            <table className="w-full min-w-[38rem] whitespace-nowrap font-mono text-xs tabular-nums text-ink-2">
              <thead>
                <tr className="border-b border-line text-ink-3">
                  <th scope="col" className="sticky left-0 z-10 bg-bg py-2 pr-4 text-left font-sans font-normal">
                    指标
                  </th>
                  {status.metrics.map((m, i) => (
                    <th
                      key={m.date}
                      scope="col"
                      title={m.date}
                      className={`py-2 pl-3 text-right font-normal ${i === 0 ? "text-ink" : ""}`}
                    >
                      {m.date.slice(5)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRIC_ROWS.map((r) => (
                  <tr key={r.label} className="border-b border-line">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-bg py-2 pr-4 text-left font-sans font-normal text-ink-3"
                    >
                      {r.label}
                    </th>
                    {status.metrics.map((m, i) => (
                      <td key={m.date} className={`py-2 pl-3 text-right ${i === 0 ? "text-ink" : ""}`}>
                        {r.render(m)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {status && status.connected && status.metrics.length === 0 && status.todayCounts.length === 0 && (
        <Notice tone="info" className="mt-10">
          已连接但还没有数据。确认手环已通过手机 Google Health App 同步上云后点“立即同步”。
        </Notice>
      )}

      <Disclosure className="mt-10 border-t border-line" summary="说明">
        <div className="space-y-1.5 text-xs leading-relaxed text-ink-3">
          <p>Fitbit Air → Google Health App → 云端 → 本应用。数据链路与踩坑记录见 docs/google-health-spike.md。</p>
          <p>训记里的训练会镜像进训练记录(动作×组×次×重量),供恢复分析与计划生成使用。</p>
        </div>
      </Disclosure>
    </div>
  );
}
