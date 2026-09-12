import { NextRequest, NextResponse } from "next/server";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { sessionCookieName, signSession } from "@/lib/auth";
import { clearLoginFailures, recordLoginFailure, throttleRemainingMs } from "@/lib/login-throttle";

// 单用户登录:.env 的 AUTH_PASSWORD_HASH = "scrypt:<saltHex>:<hashHex>"。
// 生成方式:
//   node -e "const c=require('node:crypto');const s=c.randomBytes(16);
//   console.log('scrypt:'+s.toString('hex')+':'+c.scryptSync('你的密码',s,64).toString('hex'))"
// 注意分隔符不能用 $:Next 的 @next/env 会跑 dotenv-expand,$xxx 被当环境变量引用展开成空串。
function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// 客户端 IP:必须用 nginx 注入的 X-Real-IP。
// 本项目的 nginx 用的是 $proxy_add_x_forwarded_for(追加语义),X-Forwarded-For 的最左值由
// 客户端自带、可伪造——拿它做限流键,攻击者每次换一个假 IP 就能绕过。X-Real-IP 由 nginx
// 用 $remote_addr 无条件覆盖,才可信。
// 取不到就返回 null 并跳过限流(应用只监听 127.0.0.1,生产必经 nginx):宁可少一层防护,
// 也不要因为拿不到 IP 把所有人挡在门外。
function clientIp(req: NextRequest): string | null {
  const real = req.headers.get("x-real-ip")?.trim();
  return real ? real : null;
}

// 被限流时的统一响应,带 Retry-After;登录页会直接展示 error 文案。
function tooManyAttempts(remainMs: number, prefix: string): NextResponse {
  const retryAfter = Math.max(1, Math.ceil(remainMs / 1000));
  return NextResponse.json(
    { error: `${prefix}，请 ${retryAfter} 秒后再试` },
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  );
}

export async function POST(req: NextRequest) {
  const { SESSION_SECRET, AUTH_PASSWORD_HASH } = process.env;
  if (!SESSION_SECRET || !AUTH_PASSWORD_HASH) {
    return NextResponse.json({ error: "auth not configured" }, { status: 500 });
  }

  const ip = clientIp(req);
  // 已被限流:直接返回,连 scrypt 都不算——否则限流本身会变成 CPU 放大器
  // (scrypt 是故意设计得很慢的,让攻击者拿它当免费算力是灾难)。
  if (ip) {
    const remainMs = throttleRemainingMs(ip);
    if (remainMs > 0) return tooManyAttempts(remainMs, "尝试过于频繁");
  }

  let password = "";
  try {
    const body = await req.json();
    if (typeof body?.password === "string") password = body.password;
  } catch {
    // 非 JSON body 按空密码处理,走统一的失败分支
  }

  if (!password || !verifyPassword(password, AUTH_PASSWORD_HASH)) {
    // 失败固定延迟,拖慢在线爆破(与递进退避互补:这里管"还没到阈值"的尝试)
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (ip) {
      const waitMs = recordLoginFailure(ip);
      // 刚触发阶梯:明确告知要等多久,而不是让用户反复试。
      if (waitMs > 0) return tooManyAttempts(waitMs, "密码错误，尝试过于频繁");
    }
    return NextResponse.json({ error: "密码错误" }, { status: 401 });
  }

  if (ip) clearLoginFailures(ip);
  const { token, maxAge } = await signSession(SESSION_SECRET);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge,
    // Secure 标志等配好 HTTPS 再加:裸 IP 的 HTTP 下设置 Secure 会被浏览器拒收
  });
  return res;
}
