// Google Health API 配置。凭据放根目录 .env（已被 .gitignore 忽略），参考 docs/google-health-spike.md。

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
// 本机直连 Google 被墙时必填，例如 http://127.0.0.1:7897；留空则直连。
export const GOOGLE_PROXY = process.env.GOOGLE_PROXY || "";
export const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/google/callback";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
];

export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_API_BASE = "https://health.googleapis.com/v4";

// 自动同步间隔（分钟），设为 0 关闭 instrument 里的定时器。
export const GOOGLE_SYNC_INTERVAL_MINUTES = Number(process.env.GOOGLE_SYNC_INTERVAL_MINUTES ?? 60);

export function isGoogleConfigured(): boolean {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}
