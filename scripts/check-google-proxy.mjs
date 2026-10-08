// Google 链路自检:换电脑/代理抽风时,一条命令确认"本机代理 → Google"通不通。
// 用法:
//   node scripts/check-google-proxy.mjs              # 读根目录 .env 的 GOOGLE_PROXY
//   node scripts/check-google-proxy.mjs http://127.0.0.1:7897   # 显式指定
// 判定:只要拿到 HTTP 状态码(哪怕 404/302/403)就算链路通——那说明 DNS/TLS/代理全打通,
// 只是根路径没内容;只有超时/连接失败才算不通。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(__dirname, "..", ".env");

function loadProxyFromEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return "";
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith("GOOGLE_PROXY=")) return t.slice("GOOGLE_PROXY=".length).trim();
  }
  return "";
}

const proxy = process.argv[2] || process.env.GOOGLE_PROXY || loadProxyFromEnvFile();

async function setupDispatcher(p) {
  if (!p) return;
  const { ProxyAgent, setGlobalDispatcher } = await import("undici");
  // undici 建 CONNECT 隧道默认 10s 就放弃,代理节点切换的瞬时抖动会误报,放宽到与整体超时一致
  setGlobalDispatcher(new ProxyAgent(p, { connectTimeout: TIMEOUT_MS }));
}

// 三个 Google 请求都会用到的域名:授权、换 token、数据 API
const TARGETS = [
  ["授权页", "https://accounts.google.com/o/oauth2/v2/auth"],
  ["token 接口", "https://oauth2.googleapis.com/token"],
  ["Health API", "https://health.googleapis.com/$discovery/rest?version=v4"],
];

const TIMEOUT_MS = 15_000;

async function probe(label, url) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "body-watcher-proxy-check" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - started;
    console.log(`  ✅ ${label}  HTTP ${res.status}  (${ms}ms)`);
    return true;
  } catch (err) {
    const reason = err?.cause?.code ?? err?.name ?? err?.message ?? String(err);
    console.log(`  ❌ ${label}  ${reason}  (${Date.now() - started}ms)`);
    return false;
  }
}

async function main() {
  console.log(proxy ? `代理: ${proxy}` : "代理: (未配置,直连)");
  await setupDispatcher(proxy);

  let ok = 0;
  for (const [label, url] of TARGETS) {
    if (await probe(label, url)) ok += 1;
  }

  if (ok === TARGETS.length) {
    console.log(`\n${ok}/${TARGETS.length} 全通 ✅ Google 链路正常`);
  } else {
    console.log(`\n${ok}/${TARGETS.length} 通 ❌ 先确认代理客户端(Clash 等)在跑、端口没变`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("自检脚本异常:", e.message);
  process.exit(1);
});
