import { NextRequest, NextResponse } from "next/server";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { sessionCookieName, signSession } from "@/lib/auth";

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

export async function POST(req: NextRequest) {
  const { SESSION_SECRET, AUTH_PASSWORD_HASH } = process.env;
  if (!SESSION_SECRET || !AUTH_PASSWORD_HASH) {
    return NextResponse.json({ error: "auth not configured" }, { status: 500 });
  }

  let password = "";
  try {
    const body = await req.json();
    if (typeof body?.password === "string") password = body.password;
  } catch {
    // 非 JSON body 按空密码处理,走统一的失败分支
  }

  if (!password || !verifyPassword(password, AUTH_PASSWORD_HASH)) {
    // 失败固定延迟,拖慢在线爆破
    await new Promise((resolve) => setTimeout(resolve, 600));
    return NextResponse.json({ error: "密码错误" }, { status: 401 });
  }

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
