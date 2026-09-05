// 无状态登录会话:bw_session cookie = "<到期时间戳ms>.<HMAC-SHA256 签名hex>"。
// 只用 Web Crypto 标准 API,保证在 proxy(Edge 运行时)与 Node 路由里行为一致;
// 校验用固定耗时比较,避免时序侧信道。密码本身不进 cookie。
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export const sessionCookieName = "bw_session";

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret: string, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
}

export async function signSession(secret: string): Promise<{ token: string; maxAge: number }> {
  const expires = Date.now() + SESSION_MS;
  const sig = toHex(await hmac(secret, String(expires)));
  return { token: `${expires}.${sig}`, maxAge: Math.floor(SESSION_MS / 1000) };
}

export async function verifySession(
  token: string | undefined,
  secret: string | undefined
): Promise<boolean> {
  if (!token || !secret) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expires = Number(payload);
  if (!Number.isFinite(expires) || expires <= Date.now()) return false;
  const expected = toHex(await hmac(secret, payload));
  if (sig.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
