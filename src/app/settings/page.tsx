"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { SettingActions, SettingRow } from "@/components/settings/SettingRow";
import PageHeader from "@/components/ui/PageHeader";
import Section from "@/components/ui/Section";
import Notice from "@/components/ui/Notice";
import Tag from "@/components/ui/Tag";
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
  weeklySplit: ["", "", "", "", "", "", ""],
};

const GOAL_OPTIONS = ["增肌", "减脂", "力量", "体态", "健康保持"];
const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

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
  const tone = source === "db" ? "accent" : source === "none" ? "red" : "neutral";
  return <Tag tone={tone}>{SOURCE_LABEL[source]}</Tag>;
}

const INPUT_CLS = "field w-16 px-2 text-center tabular-nums";
const TEXT_INPUT_CLS = "field min-w-0 flex-1";
const BTN_CLS = "btn btn-primary";

// 分节导航:id 为锚点 div,始终渲染以便 IntersectionObserver 注册
const NAV = [
  { key: "sleep", id: "settings-sleep", index: "01", label: "睡眠目标" },
  { key: "profile", id: "settings-profile", index: "02", label: "个人档案" },
  { key: "llm", id: "settings-llm", index: "03", label: "教练模型" },
  { key: "data", id: "settings-data", index: "04", label: "数据" },
] as const;
type NavKey = (typeof NAV)[number]["key"];
type BannerAt = "sleep" | "profile" | "llm" | null;
const SCROLL_CLS = "scroll-mt-28 md:scroll-mt-32 lg:scroll-mt-20";
const NOTE_CLS = "mb-2 max-w-[62ch] text-xs leading-relaxed text-ink-3";

export default function SettingsPage() {
  const [fields, setFields] = useState<Record<keyof SleepTargets, FieldState>>({
    minMinutes: emptyField(),
    targetMinutes: emptyField(),
    idealMinutes: emptyField(),
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // 当前高亮的分节 + 反馈提示归属哪一节(null = 页面级,如加载失败,显示在顶部)
  const [active, setActive] = useState<NavKey>("sleep");
  const [bannerAt, setBannerAt] = useState<BannerAt>(null);

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

  // 滚动时按进入视口顶部区域的分节高亮导航(setState 在 observer 回调里,不在 effect 体内)
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const k = NAV.find((n) => n.id === hit?.target.id)?.key;
        if (k) setActive(k);
      },
      { rootMargin: "-96px 0px -55% 0px" }
    );
    NAV.forEach((n) => {
      const el = document.getElementById(n.id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
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
        // 先重新读取再提示:load 内的 applyData 会 setBanner(null),放在前面成功提示会被立刻清掉
        await load().catch(() => {});
        setBanner({ kind: "ok", text: "已保存并即时生效（无需重启服务）" });
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

  // 当前节的反馈提示(banner 归属该节时才显示)
  const feedback = (k: Exclude<BannerAt, null>) =>
    banner && bannerAt === k ? <Notice tone={banner.kind}>{banner.text}</Notice> : null;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="设置" description="睡眠目标、个人档案、教练模型与数据导出" />

      {/* 手机/平板:吸顶横向分节导航 */}
      <nav
        aria-label="设置分节"
        className="sticky top-[calc(3rem+env(safe-area-inset-top))] z-20 -mx-4 mb-6 bg-bg/95 px-4 backdrop-blur md:top-14 md:-mx-6 md:px-6 lg:hidden"
      >
        <ul className="flex gap-5 overflow-x-auto overflow-y-hidden border-b border-line">
          {NAV.map((n) => (
            <li key={n.key} className="shrink-0">
              <a
                href={`#${n.id}`}
                onClick={() => setActive(n.key)}
                aria-current={active === n.key ? "location" : undefined}
                className={`relative -mb-px inline-flex h-11 items-center text-sm transition-colors ${
                  active === n.key
                    ? "text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-ink"
                    : "text-ink-3 hover:text-ink-2"
                }`}
              >
                {n.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* 页面级提示(如读取设置失败) */}
      {banner && bannerAt === null && (
        <Notice tone={banner.kind} className="mb-6">
          {banner.text}
        </Notice>
      )}

      <div className="lg:grid lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-x-12">
        {/* 桌面:左侧竖向分节导航 */}
        <nav aria-label="设置分节" className="hidden lg:block">
          <ul className="sticky top-[5.5rem] border-l border-line">
            {NAV.map((n) => (
              <li key={n.key}>
                <a
                  href={`#${n.id}`}
                  onClick={() => setActive(n.key)}
                  aria-current={active === n.key ? "location" : undefined}
                  className={`-ml-px flex items-baseline gap-2 border-l-2 py-2 pl-4 text-sm transition-colors ${
                    active === n.key ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink-2"
                  }`}
                >
                  <span className="font-mono text-[11px] text-ink-3">{n.index}</span>
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-14">
          <div id="settings-sleep" className={SCROLL_CLS}>
            <Section index="01" title="睡眠目标">
              <p className={NOTE_CLS}>
                不设目标时，系统拿“你近 7 晚的实际均值”衡量睡眠债——连日缺觉会把均值拉低，越缺越显得正常。
                设了目标后，参照线取<span className="text-ink">目标与均值里较高的</span>，目标就是你的底线，不会被自己的坏习惯向下兼容。
              </p>

              <form
                onSubmit={(e) => {
                  setBannerAt("sleep");
                  void onSubmit(e);
                }}
              >
                {ROWS.map(({ key, title, desc }) => (
                  <SettingRow key={key} label={title} htmlFor={`sleep-${key}-h`} desc={desc}>
                    <div className="flex items-center gap-1.5">
                      <input
                        id={`sleep-${key}-h`}
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
                      <span className="text-xs text-ink-3">h</span>
                      <input
                        type="number"
                        min={0}
                        max={59}
                        inputMode="numeric"
                        placeholder="分"
                        aria-label={`${title}（分钟）`}
                        className={INPUT_CLS}
                        value={fields[key].m}
                        disabled={!loaded}
                        onChange={(e) => setFields((f) => ({ ...f, [key]: { ...f[key], m: e.target.value } }))}
                      />
                      <span className="text-xs text-ink-3">min</span>
                    </div>
                  </SettingRow>
                ))}

                <SettingActions feedback={feedback("sleep")}>
                  <button type="submit" disabled={!loaded || saving} className={BTN_CLS}>
                    {saving ? "保存中..." : "保存"}
                  </button>
                  <span className="text-xs text-ink-3">全部留空 = 不设目标，回到纯历史均值口径</span>
                </SettingActions>
              </form>
            </Section>
          </div>

          <div id="settings-profile" className={SCROLL_CLS}>
            <Section index="02" title="个人档案">
              <p className={NOTE_CLS}>
                你的目标与现实约束,每次教练对话都会带上:排课按可练天数/单次时长安排量,器材与饮食约束作为硬边界。
                留空的项教练不会假设。伤病史、恢复规律这类随时间演进的细节放教练笔记更合适。
              </p>

              <form
                onSubmit={(e) => {
                  setBannerAt("profile");
                  void onSaveProfile(e);
                }}
              >
                {/* 目标:多选 chips + 自定义项(回车添加) */}
                <SettingRow label="目标">
                  <div className="space-y-2">
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
                          className="chip"
                          aria-pressed={profile.goal.includes(g)}
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
                            className="chip"
                            aria-pressed={true}
                            title="点击移除"
                          >
                            {g} ✕
                          </button>
                        ))}
                    </div>
                    <div className="max-w-xl">
                      <input
                        id="profile-goal"
                        type="text"
                        aria-label="自定义目标"
                        className="field w-full"
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
                </SettingRow>

                {/* 每周可练:范围 min–max,右侧留空 = 固定值 */}
                <SettingRow
                  label="每周可练"
                  htmlFor="profile-days-min"
                  desc="一周打算/能练几次,支持范围;右侧留空 = 就是固定值"
                >
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
                    <span className="text-xs text-ink-3">–</span>
                    <input
                      type="number"
                      min={1}
                      max={7}
                      inputMode="numeric"
                      placeholder="4"
                      aria-label="每周可练天数上限"
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
                    <span className="text-xs text-ink-3">天</span>
                  </div>
                </SettingRow>

                {/* 单次时长:范围 min–max */}
                <SettingRow
                  label="单次时长"
                  htmlFor="profile-minutes-min"
                  desc="每次可用时间(10-300 分钟),右侧留空 = 固定值"
                >
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
                    <span className="text-xs text-ink-3">–</span>
                    <input
                      type="number"
                      min={10}
                      max={300}
                      inputMode="numeric"
                      placeholder="90"
                      aria-label="单次时长上限"
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
                    <span className="text-xs text-ink-3">分钟</span>
                  </div>
                </SettingRow>

                {(
                  [
                    ["equipment", "器材/场地", "如:家里哑铃+弹力带,周末健身房"],
                    ["schedule", "作息/时间窗", "如:工作日只有午休 40 分钟,周末上午有空"],
                    ["diet", "饮食约束", "如:痛风,少海鲜内脏啤酒"],
                  ] as const
                ).map(([key, label, placeholder]) => (
                  <SettingRow key={key} label={label} htmlFor={`profile-${key}`}>
                    <input
                      id={`profile-${key}`}
                      type="text"
                      className="field w-full max-w-xl"
                      value={profile[key]}
                      disabled={!loaded}
                      placeholder={placeholder}
                      onChange={(e) => setProfile((p) => ({ ...p, [key]: e.target.value }))}
                    />
                  </SettingRow>
                ))}

                {/* 每周固定训练安排:教练排课与分析默认围绕它,除非恢复数据亮红灯 */}
                <SettingRow
                  label="每周安排"
                  desc="你跟的固定周计划,教练对话时会带上:分析默认对齐它,只有恢复/负荷数据亮红灯才建议调整某天"
                >
                  <div className="max-w-xl space-y-1.5">
                    {WEEKDAY_LABELS.map((label, i) => (
                      <div key={label} className="flex items-center gap-2">
                        <span className="w-8 shrink-0 text-xs text-ink-3">周{label}</span>
                        <input
                          value={profile.weeklySplit[i] ?? ""}
                          disabled={!loaded}
                          aria-label={`周${label}训练安排`}
                          placeholder={i === 0 ? "如 推(胸肩三头);留空 = 休息" : "训练主题,留空 = 休息"}
                          className={TEXT_INPUT_CLS}
                          onChange={(e) =>
                            setProfile((p) => {
                              const split = [...(p.weeklySplit ?? [])];
                              while (split.length < 7) split.push("");
                              split[i] = e.target.value;
                              return { ...p, weeklySplit: split };
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                </SettingRow>

                <SettingActions feedback={feedback("profile")}>
                  <button type="submit" disabled={!loaded || profileSaving} className={BTN_CLS}>
                    {profileSaving ? "保存中..." : "保存"}
                  </button>
                  <span className="text-xs text-ink-3">全部留空 = 清除档案</span>
                </SettingActions>
              </form>
            </Section>
          </div>

          <div id="settings-llm" className={SCROLL_CLS}>
            <Section index="03" title="教练模型">
              <p className={NOTE_CLS}>
                保存后即时生效，不用重启服务；某项清空保存 = 回落到 .env 兜底。
                <span className="text-ink-2"> API Key 只写入不回显</span>（页面与接口都只见掩码），换 Key 直接覆盖输入即可。
              </p>

              {llm && (
                <form
                  onSubmit={(e) => {
                    setBannerAt("llm");
                    void onSaveLlm(e);
                  }}
                >
                  <SettingRow
                    label={
                      <span className="inline-flex items-center gap-2">
                        模型 <SourceBadge source={llm.modelSource} />
                      </span>
                    }
                    htmlFor="llm-model"
                  >
                    <input
                      id="llm-model"
                      type="text"
                      className="field w-full max-w-xl"
                      value={modelInput}
                      disabled={!loaded}
                      placeholder={llm.model}
                      onChange={(e) => setModelInput(e.target.value)}
                    />
                  </SettingRow>
                  <SettingRow
                    label={
                      <span className="inline-flex items-center gap-2">
                        API 地址 <SourceBadge source={llm.baseUrlSource} />
                      </span>
                    }
                    htmlFor="llm-base-url"
                  >
                    <input
                      id="llm-base-url"
                      type="text"
                      className="field w-full max-w-xl"
                      value={baseUrlInput}
                      disabled={!loaded}
                      placeholder={llm.baseUrl}
                      onChange={(e) => setBaseUrlInput(e.target.value)}
                    />
                  </SettingRow>
                  <SettingRow
                    label={
                      <span className="inline-flex items-center gap-2">
                        API Key <SourceBadge source={llm.apiKeySource} />
                      </span>
                    }
                    htmlFor="llm-api-key"
                  >
                    <div className="flex max-w-xl gap-2">
                      <input
                        id="llm-api-key"
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
                          className={apiKeyClear ? "btn btn-danger shrink-0" : "btn btn-secondary shrink-0"}
                        >
                          {apiKeyClear ? "撤销清除" : "清除"}
                        </button>
                      )}
                    </div>
                  </SettingRow>

                  <SettingActions feedback={feedback("llm")}>
                    <button type="submit" disabled={!loaded || llmSaving} className={BTN_CLS}>
                      {llmSaving ? "保存中..." : "保存"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBannerAt("llm");
                        void onTest();
                      }}
                      disabled={!loaded || testing}
                      className="btn btn-secondary"
                    >
                      {testing ? "测试中..." : "测试连接"}
                    </button>
                    <span className="text-xs text-ink-3">测试用已保存的配置</span>
                  </SettingActions>
                </form>
              )}
            </Section>
          </div>

          {/* 最后一节加最小高度,滚到底时仍能触发高亮 */}
          <div id="settings-data" className={`${SCROLL_CLS} lg:min-h-[40vh]`}>
            <Section index="04" title="数据">
              <SettingRow label="导出" desc="导出全部数据，用于备份或迁移。">
                <a href="/api/export" className="btn btn-secondary btn-sm">
                  导出全部数据
                </a>
              </SettingRow>
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
