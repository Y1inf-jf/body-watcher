"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Card, CardTitle } from "@/components/ui/Card";
import type { UserProfile } from "@/lib/db";

const EMPTY_PROFILE: UserProfile = {
  goal: [],
  weeklyDaysMin: null,
  weeklyDaysMax: null,
  sessionMinMinutes: null,
  sessionMaxMinutes: null,
  equipment: "",
  schedule: "",
  diet: "",
};

const GOAL_OPTIONS = ["增肌", "减脂", "力量", "体态", "健康保持"];

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

// ---------- AI 配置 ----------
type LlmSource = "db" | "env" | "default" | "none";

interface LlmInfo {
  model: string;
  baseUrl: string;
  apiKeyMasked: string | null;
  modelSource: LlmSource;
  baseUrlSource: LlmSource;
  apiKeySource: LlmSource;
}

const SOURCE_LABEL: Record<LlmSource, string> = { db: "设置页", env: ".env", default: "内置默认", none: "未配置" };

function SourceBadge({ source }: { source: LlmSource }) {
  const cls =
    source === "db"
      ? "border-accent/40 bg-accent/10 text-accent"
      : source === "none"
        ? "border-zone-red/40 bg-zone-red/10 text-zone-red"
        : "border-white/10 bg-white/5 text-zinc-500";
  return <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${cls}`}>{SOURCE_LABEL[source]}</span>;
}

const INPUT_CLS = "w-14 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-center tabular-nums";
const TEXT_INPUT_CLS = "min-w-0 flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm";
const BTN_CLS = "rounded-lg bg-accent/90 px-4 py-1.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-accent disabled:opacity-50";

export default function SettingsPage() {
  const [fields, setFields] = useState<Record<keyof SleepTargets, FieldState>>({
    minMinutes: emptyField(),
    targetMinutes: emptyField(),
    idealMinutes: emptyField(),
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // AI 配置状态:文本字段 + 加载时的初始值(dirty 对比:未动的字段不提交,防止把 env 兜底值意外写进 DB)
  const [llm, setLlm] = useState<LlmInfo | null>(null);
  const [modelInput, setModelInput] = useState("");
  const [baseUrlInput, setBaseUrlInput] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyClear, setApiKeyClear] = useState(false);
  const [testing, setTesting] = useState(false);
  const [llmSaving, setLlmSaving] = useState(false);

  // 个人画像:目标/频率/时长/器材/作息/饮食,保存后注入教练提示词。
  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE);
  const [profileSaving, setProfileSaving] = useState(false);

  const applyData = useCallback((json: { sleepTargets: SleepTargets; profile?: UserProfile; llm: LlmInfo }) => {
    setFields({
      minMinutes: toField(json.sleepTargets.minMinutes),
      targetMinutes: toField(json.sleepTargets.targetMinutes),
      idealMinutes: toField(json.sleepTargets.idealMinutes),
    });
    setProfile({ ...EMPTY_PROFILE, ...(json.profile ?? {}) });
    setLlm(json.llm);
    setModelInput(json.llm.model);
    setBaseUrlInput(json.llm.baseUrl);
    setApiKeyInput("");
    setApiKeyClear(false);
    setBanner(null);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings");
    if (!res.ok) throw new Error(String(res.status));
    applyData((await res.json()) as { sleepTargets: SleepTargets; profile?: UserProfile; llm: LlmInfo });
  }, [applyData]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch {
        if (!cancelled) setBanner({ kind: "err", text: "读取设置失败，请刷新重试" });
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

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

  const onSaveProfile = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setBanner(null);
      setProfileSaving(true);
      try {
        const res = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile }),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) {
          setBanner({ kind: "err", text: json.error ?? "保存失败" });
        } else {
          setBanner({ kind: "ok", text: "已保存，教练对话即刻采用新档案" });
        }
      } catch {
        setBanner({ kind: "err", text: "网络错误，未保存" });
      } finally {
        setProfileSaving(false);
      }
    },
    [profile]
  );

  const onSaveLlm = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setBanner(null);
    if (!llm) return;
    const patch: Record<string, string> = {};
    if (modelInput.trim() !== llm.model) patch.model = modelInput.trim();
    if (baseUrlInput.trim() !== llm.baseUrl) patch.baseUrl = baseUrlInput.trim();
    if (apiKeyClear) patch.apiKey = "";
    else if (apiKeyInput.trim() !== "") patch.apiKey = apiKeyInput.trim();
    if (Object.keys(patch).length === 0) {
      setBanner({ kind: "err", text: "没有需要保存的改动" });
      return;
    }
    setLlmSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ llm: patch }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setBanner({ kind: "err", text: json.error ?? "保存失败" });
      } else {
        setBanner({ kind: "ok", text: "已保存并即时生效（无需重启服务）" });
        await load();
      }
    } catch {
      setBanner({ kind: "err", text: "网络错误，未保存" });
    } finally {
      setLlmSaving(false);
    }
  }, [llm, modelInput, baseUrlInput, apiKeyInput, apiKeyClear, load]);

  const onTest = useCallback(async () => {
    setBanner(null);
    setTesting(true);
    try {
      const res = await fetch("/api/settings/test", { method: "POST" });
      const json = (await res.json()) as { ok: boolean; message: string };
      setBanner(json.ok ? { kind: "ok", text: `连接正常，模型回复：${json.message}` } : { kind: "err", text: `连接失败：${json.message}` });
    } catch {
      setBanner({ kind: "err", text: "测试请求本身失败了" });
    } finally {
      setTesting(false);
    }
  }, []);

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
            <button type="submit" disabled={!loaded || saving} className={BTN_CLS}>
              {saving ? "保存中..." : "保存"}
            </button>
            <span className="text-[11px] text-zinc-600">全部留空 = 不设目标，回到纯历史均值口径</span>
          </div>
        </form>
      </Card>

      <Card className="p-5">
        <CardTitle>Profile · 个人档案</CardTitle>
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">
          你的目标与现实约束,每次教练对话都会带上:排课按可练天数/单次时长安排量,器材与饮食约束作为硬边界。
          留空的项教练不会假设。伤病史、恢复规律这类随时间演进的细节放教练笔记更合适。
        </p>

        <form onSubmit={onSaveProfile} className="mt-4 space-y-4">
          {/* 目标:多选 chips + 自定义项(回车添加) */}
          <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
            <span className="w-16 shrink-0 pt-1.5 text-sm font-medium text-zinc-200">目标</span>
            <div className="min-w-0 flex-1 basis-48 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {GOAL_OPTIONS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() =>
                      setProfile((p) => ({
                        ...p,
                        goal: p.goal.includes(g) ? p.goal.filter((x) => x !== g) : [...p.goal, g],
                      }))
                    }
                    className={`rounded-lg border px-3 py-1 text-xs transition-colors ${
                      profile.goal.includes(g)
                        ? "border-accent/50 bg-accent/15 text-accent"
                        : "border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-200"
                    }`}
                  >
                    {g}
                  </button>
                ))}
                {profile.goal
                  .filter((g) => !GOAL_OPTIONS.includes(g))
                  .map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setProfile((p) => ({ ...p, goal: p.goal.filter((x) => x !== g) }))}
                      className="rounded-lg border border-accent/50 bg-accent/15 px-3 py-1 text-xs text-accent"
                      title="点击移除"
                    >
                      {g} ✕
                    </button>
                  ))}
              </div>
              <input
                id="profile-goal"
                type="text"
                className={TEXT_INPUT_CLS}
                disabled={!loaded || profile.goal.length >= 5}
                placeholder="自定义目标,回车添加(最多 5 项)"
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const g = e.currentTarget.value.trim();
                  if (g && !profile.goal.includes(g) && profile.goal.length < 5) {
                    setProfile((p) => ({ ...p, goal: [...p.goal, g] }));
                    e.currentTarget.value = "";
                  }
                }}
              />
            </div>
          </div>

          {/* 每周可练:范围 min–max,右侧留空 = 固定值 */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <label className="w-16 shrink-0 text-sm font-medium text-zinc-200" htmlFor="profile-days-min">
              每周可练
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="profile-days-min"
                type="number"
                min={1}
                max={7}
                inputMode="numeric"
                placeholder="3"
                className={INPUT_CLS}
                value={profile.weeklyDaysMin ?? ""}
                disabled={!loaded}
                onChange={(e) =>
                  setProfile((p) => ({
                    ...p,
                    weeklyDaysMin: e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
              />
              <span className="text-xs text-zinc-500">–</span>
              <input
                type="number"
                min={1}
                max={7}
                inputMode="numeric"
                placeholder="4"
                className={INPUT_CLS}
                value={profile.weeklyDaysMax ?? ""}
                disabled={!loaded}
                onChange={(e) =>
                  setProfile((p) => ({
                    ...p,
                    weeklyDaysMax: e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
              />
              <span className="text-xs text-zinc-500">天</span>
            </div>
            <div className="min-w-0 flex-1 basis-48 text-[11px] text-zinc-500">
              一周打算/能练几次,支持范围;右侧留空 = 就是固定值
            </div>
          </div>

          {/* 单次时长:范围 min–max */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <label className="w-16 shrink-0 text-sm font-medium text-zinc-200" htmlFor="profile-minutes-min">
              单次时长
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="profile-minutes-min"
                type="number"
                min={10}
                max={300}
                inputMode="numeric"
                placeholder="60"
                className={INPUT_CLS}
                value={profile.sessionMinMinutes ?? ""}
                disabled={!loaded}
                onChange={(e) =>
                  setProfile((p) => ({
                    ...p,
                    sessionMinMinutes: e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
              />
              <span className="text-xs text-zinc-500">–</span>
              <input
                type="number"
                min={10}
                max={300}
                inputMode="numeric"
                placeholder="90"
                className={INPUT_CLS}
                value={profile.sessionMaxMinutes ?? ""}
                disabled={!loaded}
                onChange={(e) =>
                  setProfile((p) => ({
                    ...p,
                    sessionMaxMinutes: e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
              />
              <span className="text-xs text-zinc-500">分钟</span>
            </div>
            <div className="min-w-0 flex-1 basis-48 text-[11px] text-zinc-500">
              每次可用时间(10-300 分钟),右侧留空 = 固定值
            </div>
          </div>

          {(
            [
              ["equipment", "器材/场地", "如:家里哑铃+弹力带,周末健身房"],
              ["schedule", "作息/时间窗", "如:工作日只有午休 40 分钟,周末上午有空"],
              ["diet", "饮食约束", "如:痛风,少海鲜内脏啤酒"],
            ] as const
          ).map(([key, label, placeholder]) => (
            <div key={key} className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <label className="w-16 shrink-0 text-sm font-medium text-zinc-200" htmlFor={`profile-${key}`}>
                {label}
              </label>
              <input
                id={`profile-${key}`}
                type="text"
                className={TEXT_INPUT_CLS}
                value={profile[key]}
                disabled={!loaded}
                placeholder={placeholder}
                onChange={(e) => setProfile((p) => ({ ...p, [key]: e.target.value }))}
              />
            </div>
          ))}

          <div className="flex items-center gap-3 pt-1">
            <button type="submit" disabled={!loaded || profileSaving} className={BTN_CLS}>
              {profileSaving ? "保存中..." : "保存"}
            </button>
            <span className="text-[11px] text-zinc-600">全部留空 = 清除档案</span>
          </div>
        </form>
      </Card>

      <Card className="p-5">
        <CardTitle>AI Model · 教练模型</CardTitle>
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">
          保存后即时生效，不用重启服务；某项清空保存 = 回落到 .env 兜底。
          <span className="text-zinc-400"> API Key 只写入不回显</span>（页面与接口都只见掩码），换 Key 直接覆盖输入即可。
        </p>

        {llm && (
          <form onSubmit={onSaveLlm} className="mt-4 space-y-4">
            <div className="flex items-center gap-3">
              <label className="w-24 shrink-0 text-sm text-zinc-300">
                模型 <SourceBadge source={llm.modelSource} />
              </label>
              <input
                type="text"
                className={TEXT_INPUT_CLS}
                value={modelInput}
                disabled={!loaded}
                placeholder={llm.model}
                onChange={(e) => setModelInput(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="w-24 shrink-0 text-sm text-zinc-300">
                API 地址 <SourceBadge source={llm.baseUrlSource} />
              </label>
              <input
                type="text"
                className={TEXT_INPUT_CLS}
                value={baseUrlInput}
                disabled={!loaded}
                placeholder={llm.baseUrl}
                onChange={(e) => setBaseUrlInput(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="w-24 shrink-0 text-sm text-zinc-300">
                API Key <SourceBadge source={llm.apiKeySource} />
              </label>
              <input
                type="password"
                className={TEXT_INPUT_CLS}
                value={apiKeyInput}
                disabled={!loaded || apiKeyClear}
                autoComplete="off"
                placeholder={
                  apiKeyClear
                    ? "保存后将清除，回落 .env"
                    : llm.apiKeyMasked
                      ? `已配置 ${llm.apiKeyMasked} · 留空保持不变`
                      : "尚未配置，粘贴密钥"
                }
                onChange={(e) => {
                  setApiKeyInput(e.target.value);
                  if (e.target.value) setApiKeyClear(false);
                }}
              />
              {llm.apiKeySource !== "none" && (
                <button
                  type="button"
                  onClick={() => {
                    setApiKeyClear((v) => !v);
                    setApiKeyInput("");
                  }}
                  className={`shrink-0 rounded border px-2 py-1 text-[11px] transition-colors ${
                    apiKeyClear
                      ? "border-zone-red/50 bg-zone-red/10 text-zone-red"
                      : "border-white/10 text-zinc-500 hover:border-zone-red/40 hover:text-zone-red"
                  }`}
                >
                  {apiKeyClear ? "撤销清除" : "清除"}
                </button>
              )}
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button type="submit" disabled={!loaded || llmSaving} className={BTN_CLS}>
                {llmSaving ? "保存中..." : "保存"}
              </button>
              <button
                type="button"
                onClick={() => void onTest()}
                disabled={!loaded || testing}
                className="rounded-lg border border-zinc-700 px-4 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-white/[0.04] disabled:opacity-50"
              >
                {testing ? "测试中..." : "测试连接"}
              </button>
              <span className="text-[11px] text-zinc-600">测试用已保存的配置</span>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
