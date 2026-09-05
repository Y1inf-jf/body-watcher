// 训记 App Open API 同步:把训练记录镜像进本地 training_log / training_exercise。
// API 语义见训记官方"训练数据 Open API Skill";礼貌规则:同一 datestr 不重复请求
// (xunji_fetch_log 记录已拉取日期,force 时才重拉)。
import { gunzipSync } from "node:zlib";
import {
  getEmptyFetchedDatestrs,
  getFetchedDatestrs,
  markDatestrFetched,
  upsertXunjiTraining,
  type XunjiExerciseRow,
} from "@/lib/db";

const API_BASE = "https://trains.xunjiapp.cn";
const SCHEMA_VERSION = "train_open_api_v2";
const DAY_MS = 24 * 60 * 60 * 1000;

// 训记不返回肌群,按动作名关键词推断;顺序敏感(如"直立划船"先于"划船"命中肩,"抬腿"先于"腿"命中核心)。
const MUSCLE_RULES: [RegExp, string][] = [
  [/平板|卷腹|举腿|抬腿|腹|核心|俄罗斯转体/, "核心"],
  [/蹲|腿|臀|硬拉|弓步|腿弯举|腿屈伸|提踵|史密斯/, "腿"],
  // 反向飞鸟练三角肌后束,必须排在"飞鸟→胸"之前;后束同理。
  [/反向飞鸟|反飞鸟|后束/, "肩"],
  [/卧推|卧|胸|飞鸟|夹胸|俯卧撑/, "胸"],
  [/推举|肩|侧平举|面拉|直立划船/, "肩"],
  [/划船|下拉|引体|背|直臂下压/, "背"],
  [/弯举|臂屈伸|二头|三头|下压|臂/, "手臂"],
];

function inferMuscleGroup(name: string): string {
  for (const [re, group] of MUSCLE_RULES) {
    if (re.test(name)) return group;
  }
  return "其他";
}

export function isXunjiConfigured(): boolean {
  return Boolean(process.env.XUNJI_API_KEY);
}

// 手机健康 App 自动回灌的条目(与真实训练同起止时间),跳过避免重复。
function isHealthMirrorTrain(train: RawTrain): boolean {
  return /^运动类型\s*\d*$/.test((train.title ?? "").trim());
}

interface RawSet {
  done?: boolean;
  weight?: string | number;
  unit?: string;
  reps?: string | number;
  rpe?: string | number;
  items?: { name?: string; set?: RawSet }[];
}

interface RawMovement {
  name?: string;
  sets?: RawSet[];
}

interface RawTrain {
  title?: string;
  start?: number;
  end?: number;
  localid?: number;
  note?: string;
  movements?: RawMovement[];
}

async function fetchTrainDate(datestr: string): Promise<RawTrain[]> {
  const res = await fetch(`${API_BASE}/api_trains_for_llm_v2`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.XUNJI_API_KEY ?? ""}`,
      "content-type": "application/json",
      "accept-encoding": "gzip",
    },
    body: JSON.stringify({ schema_version: SCHEMA_VERSION, datestr, include_full_data: true }),
  });
  if (res.status === 401) throw new Error("训记 API Key 无效(401)");
  if (res.status === 429) throw new Error("训记接口限流(429),稍后再试");
  if (!res.ok) throw new Error(`训记接口 HTTP ${res.status}`);
  // 兼容服务端无条件 gzip:undici 通常自动解压,若仍拿到 gzip 魔数则手动解。
  const buf = Buffer.from(await res.arrayBuffer());
  const jsonText = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  const body = JSON.parse(jsonText) as { res?: { trains?: RawTrain[] } };
  return body.res?.trains ?? [];
}

function num(v: string | number | undefined | null): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function collectExerciseRows(train: RawTrain): XunjiExerciseRow[] {
  const rows: XunjiExerciseRow[] = [];
  for (const movement of train.movements ?? []) {
    for (const set of movement.sets ?? []) {
      // 超级组:子动作展平成独立行;普通组直接映射。
      if (set.items && set.items.length > 0) {
        for (const item of set.items) {
          const inner = item.set ?? {};
          rows.push({
            exercise_name: item.name || movement.name || "未知动作",
            muscle_group: inferMuscleGroup(item.name || movement.name || ""),
            reps: num(inner.reps),
            weight: num(inner.weight),
            rpe: num(inner.rpe),
          });
        }
      } else {
        rows.push({
          exercise_name: movement.name || "未知动作",
          muscle_group: inferMuscleGroup(movement.name ?? ""),
          reps: num(set.reps),
          weight: num(set.weight),
          rpe: num(set.rpe),
        });
      }
    }
  }
  return rows;
}

export interface XunjiSyncResult {
  status: "success" | "partial" | "error";
  dates: string[];
  created: number;
  updated: number;
  skippedHealthMirrors: number;
  errors: string[];
}

async function syncAll(opts: { days: number; force: boolean }): Promise<XunjiSyncResult> {
  const errors: string[] = [];
  let created = 0;
  let updated = 0;
  let skippedHealthMirrors = 0;
  const touchedDates: string[] = [];

  // 上限 366:足够一次全量回填一年;日常同步只传 7。
  const days = Math.min(Math.max(opts.days, 1), 366);
  const fetched = new Set(getFetchedDatestrs());
  // 当日 0 条 ≠ 确认休息:训练可能是之后才录入/上传的,这类日期每次同步都重新查一次。
  const emptyDays = new Set(getEmptyFetchedDatestrs());
  const today = new Date();
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today.getTime() - i * DAY_MS);
    const datestr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (opts.force || !fetched.has(datestr) || emptyDays.has(datestr)) dates.push(datestr);
  }

  for (const datestr of dates) {
    // 批量回填时限速,避免短时间打满接口。
    if (dates.length > 10) {
      await new Promise((r) => setTimeout(r, 250));
    }
    try {
      const trains = await fetchTrainDate(datestr);
      for (const train of trains) {
        if (isHealthMirrorTrain(train)) {
          skippedHealthMirrors += 1;
          continue;
        }
        if (!train.localid) continue;
        const durationMinutes =
          train.start && train.end ? Math.max(1, Math.round((train.end - train.start) / 60000)) : 0;
        const { created: isCreated } = upsertXunjiTraining(
          {
            date: datestr,
            title: train.title ?? null,
            duration: durationMinutes,
            notes: train.note ?? null,
            external_id: String(train.localid),
          },
          collectExerciseRows(train)
        );
        if (isCreated) created += 1;
        else updated += 1;
      }
      markDatestrFetched(datestr, trains.length);
      touchedDates.push(datestr);
    } catch (err) {
      // 失败的 datestr 不标记,下次同步自动重试。
      errors.push(`${datestr}: ${(err as Error).message}`);
    }
  }

  const status: XunjiSyncResult["status"] =
    errors.length === 0 ? "success" : touchedDates.length > 0 ? "partial" : "error";
  return { status, dates: touchedDates, created, updated, skippedHealthMirrors, errors };
}

let _running: Promise<XunjiSyncResult> | null = null;

export function runXunjiSync(opts: { days?: number; force?: boolean } = {}): Promise<XunjiSyncResult> {
  if (_running) return _running;
  _running = syncAll({ days: opts.days ?? 7, force: opts.force ?? false }).finally(() => {
    _running = null;
  });
  return _running;
}
