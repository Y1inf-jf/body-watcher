import { NextRequest, NextResponse } from "next/server";
import {
  getSleepTargets,
  setSleepTargets,
  getLlmSettings,
  setLlmSettings,
  getUserProfile,
  setUserProfile,
  normalizeWeeklySplit,
  type SleepTargets,
  type LlmSettings,
  type UserProfile,
} from "@/lib/db";
import { resolveLlmConfig } from "@/lib/llm";

// GET 一律不回明文 Key:只给掩码(末4位)与来源标记。写 Key 仅 POST 单向。
function maskKey(key: string | null): string | null {
  if (!key) return null;
  return key.length <= 8 ? "****" : `****${key.slice(-4)}`;
}

export async function GET() {
  const cfg = resolveLlmConfig();
  const dbLlm = getLlmSettings();
  return NextResponse.json({
    sleepTargets: getSleepTargets(),
    profile: getUserProfile(),
    llm: {
      // 当前生效值(model/baseUrl 可直接展示;Key 永远掩码)。
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      apiKeyMasked: maskKey(cfg.apiKey),
      // 生效值来源:db=设置页覆盖 / env=.env 兜底 / default=内置默认 / none=未配置。
      modelSource: cfg.source.model,
      baseUrlSource: cfg.source.baseUrl,
      apiKeySource: cfg.source.apiKey,
      // DB 是否存有该字段(决定表单"清除"按钮的可用性)。
      dbSet: {
        model: dbLlm.model !== null,
        baseUrl: dbLlm.baseUrl !== null,
        apiKey: dbLlm.apiKey !== null,
      },
    },
  });
}

// 两段各自独立提交(页面两个表单共用本端点),至少带一段。
// sleepTargets 校验:每档 [240,720] 整数或 null,已设档 min ≤ target ≤ ideal。
const TARGET_KEYS = ["minMinutes", "targetMinutes", "idealMinutes"] as const;

function parseSleepTargets(raw: unknown): SleepTargets | string {
  if (typeof raw !== "object" || raw === null) return "sleepTargets 需为对象";
  const values = raw as Record<string, unknown>;
  const parsed = {} as SleepTargets;
  for (const key of TARGET_KEYS) {
    const v = values[key];
    if (v === null) {
      parsed[key] = null;
      continue;
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 240 || n > 720) {
      return "睡眠每档需要 240-720 的整数分钟数,或留空(null)";
    }
    parsed[key] = n;
  }
  const ordered = TARGET_KEYS.map((k) => parsed[k]).filter((v): v is number => v !== null);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i] < ordered[i - 1]) return "睡眠三档需满足 最低 ≤ 目标 ≤ 理想";
  }
  return parsed;
}

// llm 校验:字段缺省=不改,""=清除回落 .env,非空=写入。
const LLM_FIELD_KEYS = ["model", "baseUrl", "apiKey"] as const;

function parseLlm(raw: unknown): Partial<LlmSettings> | string {
  if (typeof raw !== "object" || raw === null) return "llm 需为对象";
  const values = raw as Record<string, unknown>;
  const parsed = {} as Partial<LlmSettings>;
  for (const key of LLM_FIELD_KEYS) {
    const v = values[key];
    if (v === undefined) continue;
    if (typeof v !== "string") return `${key} 需为字符串(留空表示清除)`;
    const s = v.trim();
    if (key === "model" && s !== "" && (s.length > 100 || /\s/.test(s))) {
      return "模型名需为不含空格的字符串(≤100 字符)";
    }
    if (key === "baseUrl" && s !== "" && !/^https?:\/\/\S{1,200}$/.test(s)) {
      return "接口地址需以 http(s):// 开头";
    }
    if (key === "apiKey" && s !== "" && (s.length < 8 || s.length > 300)) {
      return "API Key 长度需在 8-300 之间";
    }
    (parsed as Record<string, string>)[key] = s;
  }
  if (Object.keys(parsed).length === 0) return "llm 段没有任何字段";
  return parsed;
}

// profile 校验:目标/器材/作息/饮食为短文本,周频 1-7,单次时长 10-300 分钟;字段缺省=未设。
function parseProfile(raw: unknown): UserProfile | string {
  if (typeof raw !== "object" || raw === null) return "profile 需为对象";
  const v = raw as Record<string, unknown>;

  // goal:字符串数组(多选),每项 trim 后 1-30 字;空数组/缺省 = 未设。
  let goal: string[] = [];
  if (v.goal !== undefined && v.goal !== null) {
    if (!Array.isArray(v.goal)) return "goal 需为字符串数组";
    goal = v.goal
      .map((g) => (typeof g === "string" ? g.trim() : ""))
      .filter((g) => g !== "");
    if (goal.some((g) => g.length > 30)) return "每个目标不超过 30 字";
    if (goal.length > 5) return "目标最多 5 项";
  }

  // 范围字段:min 必须整数, max 可空(=固定值);都给时 max ≥ min。
  const range = (
    minRaw: unknown,
    maxRaw: unknown,
    lo: number,
    hi: number,
    unit: string
  ): { min: number | null; max: number | null } | string => {
    const min = minRaw === undefined || minRaw === null || minRaw === "" ? null : Number(minRaw);
    const max = maxRaw === undefined || maxRaw === null || maxRaw === "" ? null : Number(maxRaw);
    const ok = (n: number) => Number.isInteger(n) && n >= lo && n <= hi;
    if (min === null && max !== null) return `${unit}:只填了上限,请补下限(或两个都留空)`;
    if (min !== null && !ok(min)) return `${unit}下限需为 ${lo}-${hi} 的整数`;
    if (max !== null && (!ok(max) || (min !== null && max < min))) {
      return `${unit}上限需为 ${lo}-${hi} 的整数且不小于下限`;
    }
    return { min, max };
  };
  const days = range(v.weeklyDaysMin, v.weeklyDaysMax, 1, 7, "每周可练天数");
  if (typeof days === "string") return days;
  const minutes = range(v.sessionMinMinutes, v.sessionMaxMinutes, 10, 300, "单次时长");
  if (typeof minutes === "string") return minutes;

  // 返回 undefined 表示该字段非法(类型错或超长);空/缺省 = 未设,规范为空串。
  const text = (name: string, max: number): string | undefined => {
    const x = v[name];
    if (x === undefined || x === null || x === "") return "";
    if (typeof x !== "string") return undefined;
    const s = x.trim();
    return s === "" || s.length <= max ? s : undefined;
  };
  const equipment = text("equipment", 200);
  const schedule = text("schedule", 200);
  const diet = text("diet", 200);
  if (equipment === undefined || schedule === undefined || diet === undefined) {
    return "profile 文本字段超长或类型错误(不超过 200 字)";
  }

  // 每周固定训练安排:7 项对应周一~周日,每项 ≤40 字;缺省=未跟固定计划。
  const weeklySplit = normalizeWeeklySplit(v.weeklySplit);

  return {
    goal,
    weeklyDaysMin: days.min,
    weeklyDaysMax: days.max,
    sessionMinMinutes: minutes.min,
    sessionMaxMinutes: minutes.max,
    equipment,
    schedule,
    diet,
    weeklySplit,
  };
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const hasSleep = body.sleepTargets !== undefined;
  const hasLlm = body.llm !== undefined;
  const hasProfile = body.profile !== undefined;
  if (!hasSleep && !hasLlm && !hasProfile) {
    return NextResponse.json({ error: "至少提供 sleepTargets / llm / profile 一段" }, { status: 400 });
  }
  if (hasSleep) {
    const parsed = parseSleepTargets(body.sleepTargets);
    if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
    setSleepTargets(parsed);
  }
  if (hasLlm) {
    const parsed = parseLlm(body.llm);
    if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
    setLlmSettings(parsed);
  }
  if (hasProfile) {
    const parsed = parseProfile(body.profile);
    if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
    setUserProfile(parsed);
  }
  return NextResponse.json({ ok: true });
}
