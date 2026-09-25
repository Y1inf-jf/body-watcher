#!/usr/bin/env node
// 常驻 SSH 反向隧道:把本机 Clash(127.0.0.1:7897)映射到云服务器的 127.0.0.1:7897,
// 服务器 .env 里 GOOGLE_PROXY=http://127.0.0.1:7897 即可访问 Google(服务器直连被墙)。
// 远端显式绑 127.0.0.1,公网访问不到这个代理口;只跑一个实例,第二个会因远端端口被占而
// 退出重试(ExitOnForwardFailure),不会互相打架。
//
// 手动运行:  node scripts/google-tunnel.mjs
// 登录自启: scripts/start-google-tunnel.cmd 放在启动文件夹(schtasks 的 ONLOGON 触发器
// 要管理员,启动文件夹不用)。放入命令:
//   cp scripts/start-google-tunnel.cmd "$APPDATA/Microsoft/Windows/Start Menu/Programs/Startup/"
// 依赖: ~/.ssh/config 里的 Host body-watcher(免密公钥) + 本机 Clash Verge 在跑。
import { spawn } from "node:child_process";
import net from "node:net";

const SSH_HOST = process.env.TUNNEL_HOST || "body-watcher";
const REMOTE_BIND = process.env.TUNNEL_REMOTE || "127.0.0.1:17897"; // 服务器侧,与服务器 .env 的 GOOGLE_PROXY 端口一致
const LOCAL_TARGET = process.env.TUNNEL_LOCAL || "127.0.0.1:7897"; // 本机 Clash
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 60_000;
const STABLE_MS = 5 * 60_000; // 单次连接存活超过此时长,视为稳定,重置退避

let stopping = false;
let nextDelayMs = BASE_DELAY_MS;
let child = null;

function log(msg) {
  process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`);
}

// Clash 没跑时隧道照样能建(本地连接是逐请求懒连接),但每条请求都会失败——启动时主动提醒一次
function checkLocalClash() {
  const [host, port] = LOCAL_TARGET.split(":");
  const socket = net.connect({ host, port: Number(port), timeout: 2_000 });
  return new Promise((resolve) => {
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(false));
  });
}

function tagStream(stream) {
  stream.setEncoding("utf8");
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      log(`ssh> ${buf.slice(0, i)}`);
      buf = buf.slice(i + 1);
    }
  });
  stream.on("end", () => buf && log(`ssh> ${buf}`));
}

function connect() {
  log(`建立隧道 ${SSH_HOST}  -R ${REMOTE_BIND} → ${LOCAL_TARGET}`);
  child = spawn(
    "ssh",
    [
      "-N",
      "-T",
      "-o", "ExitOnForwardFailure=yes",
      "-o", "ServerAliveInterval=15",
      "-o", "ServerAliveCountMax=3",
      "-o", "StrictHostKeyChecking=accept-new",
      "-R", `${REMOTE_BIND}:${LOCAL_TARGET}`,
      SSH_HOST,
    ],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
  );
  tagStream(child.stdout);
  tagStream(child.stderr);

  const startedAt = Date.now();
  child.on("exit", (code, signal) => {
    child = null;
    if (stopping) return;
    if (Date.now() - startedAt > STABLE_MS) nextDelayMs = BASE_DELAY_MS;
    log(`ssh 退出(code=${code ?? "-"}, signal=${signal ?? "-" }),${nextDelayMs / 1000}s 后重连`);
    setTimeout(connect, nextDelayMs);
    nextDelayMs = Math.min(nextDelayMs * 2, MAX_DELAY_MS);
  });
  child.on("error", (err) => log(`ssh 进程异常: ${err.message}`));
}

async function main() {
  if (!(await checkLocalClash())) {
    log(`警告: 本机 ${LOCAL_TARGET} 没有监听——Clash Verge 没开?隧道建立后服务器请求仍会失败`);
  }
  connect();
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    stopping = true;
    log(`收到 ${sig},关闭隧道退出`);
    if (child) child.kill();
    else process.exit(0);
  });
}
// 子进程退出后由 stopping 短路,这里兜底确保进程真的退出
process.on("exit", () => child && child.kill());

main();
