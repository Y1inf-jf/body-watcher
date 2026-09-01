// Google Health API 打样验证(Phase 0)
// 用法: node scripts/google-health-spike/spike.mjs
// 前置: 同目录 .env 填好 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET(/ GOOGLE_PROXY)
// 流程: 无 token 时走一遍浏览器授权 → 换 token 存本地 → 拉几个数据点验证链路
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(__dirname, ".env");
const TOKEN_FILE = path.join(__dirname, ".tokens.json");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://health.googleapis.com/v4";
const REDIRECT_URI = "http://localhost:8765/callback";
const SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
];

function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) {
    console.error(`缺少配置文件 ${ENV_FILE}，请先创建并填入 client_id / client_secret`);
    process.exit(1);
  }
  const env = {};
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

// Node 的 fetch 默认不理会 HTTPS_PROXY，这里用 undici 显式挂代理
async function setupProxy(proxy) {
  if (!proxy) return;
  const { ProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new ProxyAgent(proxy));
  console.log(`已挂代理 ${proxy}`);
}

const readTokens = () =>
  fs.existsSync(TOKEN_FILE) ? JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8")) : null;
const saveTokens = (t) => fs.writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2));

async function postForm(url, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`token 接口 HTTP ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function authorize(clientId, clientSecret) {
  const consent = new URL(AUTH_URL);
  consent.searchParams.set("client_id", clientId);
  consent.searchParams.set("redirect_uri", REDIRECT_URI);
  consent.searchParams.set("response_type", "code");
  consent.searchParams.set("scope", SCOPES.join(" "));
  consent.searchParams.set("access_type", "offline");
  consent.searchParams.set("prompt", "consent");

  console.log("\n请在浏览器打开下面的链接，用手机 Google Health App 同款账号登录并同意授权：\n");
  console.log(consent.toString() + "\n");

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const raw = req.url ?? "";
      console.log(`收到回调: ${raw}`);
      const u = new URL(raw, REDIRECT_URI);
      if (u.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const err = u.searchParams.get("error");
      // 从原始 query 里解 code,用 decodeURIComponent 而非 searchParams,
      // 避免 code 中的 '+' 被当成空格之类的转义坑
      const m = raw.match(/[?&]code=([^&]+)/);
      const code = m ? decodeURIComponent(m[1]) : null;
      console.log(`解出的授权码: ${code ?? "(空!)"}`);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(err ? "<h2>授权失败，回终端看错误</h2>" : "<h2>授权成功，回终端继续</h2>");
      server.close(() => (err ? reject(new Error(`授权被拒绝: ${err}`)) : resolve(code)));
    });
    server.on("error", reject);
    server.listen(8765, () => console.log("等待授权回调 (http://localhost:8765/callback) ..."));
  });

  const tokens = await postForm(TOKEN_URL, {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  });
  console.log("已拿到 token 并存入 .tokens.json");
  return { ...tokens, obtained_at: Date.now() };
}

async function ensureFresh(tokens, clientId, clientSecret) {
  const expiresAt = (tokens.obtained_at ?? 0) + (tokens.expires_in ?? 0) * 1000 - 60_000;
  if (tokens.access_token && Date.now() < expiresAt) return tokens;
  if (!tokens.refresh_token) {
    console.error("没有 refresh_token，需要重新授权(删除 .tokens.json 后重跑)");
    process.exit(1);
  }
  console.log("access_token 过期，用 refresh_token 刷新 ...");
  const fresh = await postForm(TOKEN_URL, {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: tokens.refresh_token,
    grant_type: "refresh_token",
  });
  const next = { ...tokens, ...fresh, obtained_at: Date.now() };
  saveTokens(next);
  return next;
}

async function apiGet(accessToken, apiPath) {
  const res = await fetch(`${API_BASE}${apiPath}`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  return { status: res.status, text: await res.text() };
}

function summarize(text) {
  try {
    const obj = JSON.parse(text);
    const pretty = JSON.stringify(obj, null, 2);
    const points = obj.dataPoints?.length ?? 0;
    const head = points > 0 ? JSON.stringify(obj.dataPoints[0], null, 2) : pretty;
    console.log(`共 ${points} 个 dataPoint，第一个长这样:`);
    console.log(head.length > 1500 ? head.slice(0, 1500) + "\n... (截断)" : head);
  } catch {
    console.log(text.length > 800 ? text.slice(0, 800) + "\n... (截断)" : text);
  }
}

async function main() {
  const env = loadEnv();
  if (!env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_SECRET.includes("在这里填")) {
    console.error("请先在 .env 里填好 GOOGLE_CLIENT_ID 和 GOOGLE_CLIENT_SECRET");
    process.exit(1);
  }
  await setupProxy(env.GOOGLE_PROXY);

  let tokens = readTokens();
  if (!tokens?.refresh_token) {
    tokens = await authorize(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
    saveTokens(tokens);
  } else {
    tokens = await ensureFresh(tokens, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  }

  const calls = [
    ["/users/me/identity", "身份映射(新旧 user id)"],
    ["/users/me/dataTypes/sleep/dataPoints?pageSize=3", "睡眠"],
    ["/users/me/dataTypes/daily-heart-rate-variability/dataPoints?pageSize=3", "每日 HRV"],
    ["/users/me/dataTypes/daily-resting-heart-rate/dataPoints?pageSize=3", "每日静息心率"],
    ["/users/me/dataTypes/steps/dataPoints?pageSize=3", "步数"],
  ];
  for (const [apiPath, label] of calls) {
    console.log(`\n===== ${label}  GET ${apiPath}`);
    let { status, text } = await apiGet(tokens.access_token, apiPath);
    if (status === 401) {
      console.log("401，刷新后重试一次 ...");
      tokens = await ensureFresh({ ...tokens, expires_in: 0 }, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
      ({ status, text } = await apiGet(tokens.access_token, apiPath));
    }
    console.log(`HTTP ${status}`);
    if (status === 200) summarize(text);
    else console.log(text.slice(0, 500));
  }

  console.log("\n打样验证结束。全绿的话链路就是通的 ✅");
}

main().catch((e) => {
  console.error("\n失败:", e.message);
  process.exit(1);
});
