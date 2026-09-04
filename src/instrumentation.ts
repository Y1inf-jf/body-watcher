// Next.js 16 server 实例启动钩子：启动后自动同步一次 Google Health，之后按间隔定时同步。
// globalThis 守卫防止 dev 热更新时注册多个定时器。GOOGLE_SYNC_INTERVAL_MINUTES=0 可整体关闭。
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.GOOGLE_SYNC_INTERVAL_MINUTES === "0") return;

  const g = globalThis as typeof globalThis & { __bodyWatcherGoogleSyncStarted?: boolean };
  if (g.__bodyWatcherGoogleSyncStarted) return;
  g.__bodyWatcherGoogleSyncStarted = true;

  const { runSync } = await import("@/lib/google/sync");
  const minutes = Number(process.env.GOOGLE_SYNC_INTERVAL_MINUTES ?? 60);

  // 启动稍等片刻再同步，避免拖慢服务就绪；失败只记日志（详情在 google_sync_log / 状态页）。
  setTimeout(() => {
    runSync().catch((err) => console.error("[google-sync]", err instanceof Error ? err.message : err));
  }, 5000).unref();

  if (Number.isFinite(minutes) && minutes > 0) {
    setInterval(() => {
      runSync().catch((err) => console.error("[google-sync]", err instanceof Error ? err.message : err));
    }, minutes * 60_000).unref();
  }
}
