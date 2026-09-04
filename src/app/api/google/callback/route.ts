import { NextRequest, NextResponse } from "next/server";
import { exchangeGoogleCode } from "@/lib/google/auth";

// OAuth 回调：校验 state → 换 token 入库 → 回到状态页。redirect 不放 try 内（Next 控制流约定）。
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  // searchParams 会把 code 里的 "+" 解码成空格(docs/google-health-spike.md 踩坑 #5),
  // 导致换 token 报 invalid_grant,必须从原始 query 提取后再 decodeURIComponent。
  const code = url.search.match(/[?&]code=([^&]+)/)?.[1] ?? null;
  const code_ = code === null ? null : decodeURIComponent(code);
  const state = url.searchParams.get("state");
  const cookieState = request.cookies.get("google_oauth_state")?.value;
  const denied = url.searchParams.get("error");

  let failure: string | null = null;
  if (denied) {
    failure = `授权被拒绝：${denied}`;
  } else if (!code_ || !state || !cookieState || state !== cookieState) {
    failure = "回调参数校验失败，请回到“数据同步”页重新发起授权";
  } else {
    try {
      await exchangeGoogleCode(code_);
    } catch (err) {
      failure = `换取 token 失败：${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const target = failure
    ? `/google?error=${encodeURIComponent(failure)}`
    : "/google?connected=1";
  const res = NextResponse.redirect(new URL(target, request.url));
  res.cookies.delete("google_oauth_state");
  return res;
}
