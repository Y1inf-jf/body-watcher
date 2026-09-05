import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName, verifySession } from "@/lib/auth";

// 全站登录墙。注意:Next 16 起 Middleware 更名为 Proxy,文件约定是 src/proxy.ts,
// 具名导出 proxy(旧版写 middleware.ts 在本版本不生效)。
// 未登录:页面请求 → 302 /login;API 请求 → 401 JSON(前端 fetch 能拿到明确状态码)。
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout"]);

export async function proxy(req: NextRequest) {
  if (PUBLIC_PATHS.has(req.nextUrl.pathname)) {
    return NextResponse.next();
  }
  const ok = await verifySession(
    req.cookies.get(sessionCookieName)?.value,
    process.env.SESSION_SECRET
  );
  if (ok) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // 静态资源与图标不走登录墙
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
