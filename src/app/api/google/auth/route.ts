import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { buildConsentUrl } from "@/lib/google/auth";
import { isGoogleConfigured } from "@/lib/google/config";

// 发起授权：生成 state 防 CSRF，写 httpOnly cookie，302 到 Google 同意页。
export async function GET() {
  if (!isGoogleConfigured()) {
    return NextResponse.json({ error: "未配置 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET（见 .env.example）" }, { status: 500 });
  }
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(buildConsentUrl(state));
  res.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    path: "/",
    maxAge: 600,
    sameSite: "lax",
  });
  return res;
}
