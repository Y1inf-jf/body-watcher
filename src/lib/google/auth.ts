// Google Health API 的 OAuth token 生命周期：换码、刷新、落库，以及带代理的 fetch 封装。
// 代理只作用于对 Google 的请求（undici 按请求挂 dispatcher），不影响 DeepSeek 等其他出站流量。
import { fetch as undiciFetch, ProxyAgent } from "undici";
import {
  deleteGoogleTokens,
  getGoogleTokens,
  saveGoogleTokens,
} from "@/lib/db";
import {
  GOOGLE_API_BASE,
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_PROXY,
  GOOGLE_REDIRECT_URI,
  GOOGLE_SCOPES,
  GOOGLE_TOKEN_ENDPOINT,
} from "./config";

export class GoogleNotConnectedError extends Error {
  constructor(message = "尚未连接 Google Health，请先在“数据同步”页完成授权") {
    super(message);
    this.name = "GoogleNotConnectedError";
  }
}

let _proxyAgent: ProxyAgent | null = null;
function proxyDispatcher(): ProxyAgent | undefined {
  if (!GOOGLE_PROXY) return undefined;
  if (!_proxyAgent) _proxyAgent = new ProxyAgent(GOOGLE_PROXY);
  return _proxyAgent;
}

type UndiciInit = Parameters<typeof undiciFetch>[1];

// 出站超时:对 Google 的请求统一 30s 上限。
// 没有它时,隧道半开或代理卡住会让请求一直挂着——runSync 的并发护栏是"共享同一次进行中的
// 同步"而非"超时放弃",一旦挂死就再也不会自愈,小时级定时器等于失效,只能重启进程。
// LLM 侧本来就有超时(testLlmConnection 20s / agentLoop 180s),这里补齐同样的保护。
const GOOGLE_TIMEOUT_MS = 30_000;

// 统一出口：对 Google 的所有 HTTP 都走这里。
export async function googleFetch(url: string | URL, init: UndiciInit = {}): Promise<Response> {
  const res = await undiciFetch(url, {
    ...init,
    dispatcher: proxyDispatcher(),
    // 调用方显式传了 signal 就尊重它(上游取消),否则套默认超时。
    signal: init.signal ?? AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
  });
  return res as unknown as Response;
}

export function buildConsentUrl(state: string): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", GOOGLE_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("state", state);
  // offline + consent：确保拿到 refresh_token（Google 只在首次授权发，consent 可强制重发）。
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  // 注意：不要带 include_granted_scopes，旧 Fit scope 混入 token 会导致数据接口 403。
  return url.toString();
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function postToken(params: Record<string, string>): Promise<TokenResponse> {
  const res = await googleFetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok) {
    const err = new Error(
      `Google token 接口错误 ${res.status}: ${body.error_description || body.error || "未知错误"}`
    ) as Error & { code?: string };
    err.code = body.error;
    throw err;
  }
  return body;
}

export async function exchangeGoogleCode(code: string): Promise<void> {
  const body = await postToken({
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: GOOGLE_REDIRECT_URI,
    grant_type: "authorization_code",
  });
  if (!body.access_token) throw new Error("Google 未返回 access_token");
  saveGoogleTokens({
    access_token: body.access_token,
    refresh_token: body.refresh_token ?? null,
    expires_at: Date.now() + (body.expires_in ?? 3600) * 1000,
    scope: body.scope ?? null,
  });
}

// 供各调用方获取可用 token：过期前 60s 自动刷新；刷新失败且不可恢复时清除本地授权。
export async function getValidAccessToken(): Promise<string> {
  const tokens = getGoogleTokens();
  if (!tokens?.access_token) throw new GoogleNotConnectedError();
  if (Date.now() < tokens.expires_at - 60_000) return tokens.access_token;
  if (!tokens.refresh_token) {
    deleteGoogleTokens();
    throw new GoogleNotConnectedError("本地缺少 refresh_token，请重新连接");
  }
  try {
    const body = await postToken({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    });
    if (!body.access_token) throw new Error("Google 未返回 access_token");
    // 刷新期间用户可能已断开连接:若本地 refresh_token 已不是当初读到的那个,丢弃刷新结果,
    // 否则 saveGoogleTokens 的 upsert 会把刚删掉的凭据复活。
    const current = getGoogleTokens();
    if (!current || current.refresh_token !== tokens.refresh_token) {
      throw new GoogleNotConnectedError("连接状态已变更,请重新连接");
    }
    saveGoogleTokens({
      access_token: body.access_token,
      refresh_token: body.refresh_token ?? tokens.refresh_token,
      expires_at: Date.now() + (body.expires_in ?? 3600) * 1000,
      scope: body.scope ?? tokens.scope,
    });
    return body.access_token;
  } catch (err) {
    if ((err as { code?: string }).code === "invalid_grant") {
      // refresh token 已失效（7 天未用/用户撤销/测试模式过期），只能重走授权。
      deleteGoogleTokens();
      throw new GoogleNotConnectedError("Google 授权已失效，请重新连接");
    }
    throw err;
  }
}

export interface GoogleDataPoint {
  name?: string;
  dataSource?: Record<string, unknown>;
  [key: string]: unknown;
}

// list 端点：users/me/dataTypes/{dataType}/dataPoints，分页拉全。
// 参考: https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/list
export async function listGoogleDataPoints(
  accessToken: string,
  dataType: string,
  opts: { pageSize?: number; filter?: string; maxPages?: number } = {}
): Promise<GoogleDataPoint[]> {
  const { pageSize = 10000, filter, maxPages = 50 } = opts;
  const points: GoogleDataPoint[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const url = new URL(`${GOOGLE_API_BASE}/users/me/dataTypes/${dataType}/dataPoints`);
    url.searchParams.set("pageSize", String(pageSize));
    if (filter) url.searchParams.set("filter", filter);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await googleFetch(url, {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`${dataType}: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    const body = JSON.parse(text) as { dataPoints?: GoogleDataPoint[]; nextPageToken?: string };
    points.push(...(body.dataPoints ?? []));
    pageToken = body.nextPageToken || undefined;
    pages += 1;
  } while (pageToken && pages < maxPages);
  return points;
}
