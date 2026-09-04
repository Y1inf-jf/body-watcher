// Next.js 16 server 实例启动钩子：启动后自动同步一次，之后按间隔定时同步。
// globalThis 守卫防止 dev 热更新时注册多个定时器。GOOGLE_SYNC_INTERVAL_MINUTES=0 可整体关闭定时器。
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.GOOGLE_SYNC_INTERVAL_MINUTES === "0") return;

  const g = globalThis as typeof globalThis & { __bodyWatcherGoogleSyncStarted?: boolean };
  if (g.__bodyWatcherGoogleSyncStarted) return;
  g.__bodyWatcherGoogleSyncStarted = true;

  const { runSync } = await import("@/lib/google/sync");
  const { isGoogleConfigured } = await import("@/lib/google/config");
  const minutes = Number(process.env.GOOGLE_SYNC_INTERVAL_MINUTES ?? 60);

  // Google 未配置时不跑同步,否则每小时留一条无意义的 error 日志。
  const syncGoogle = () => {
    if (!isGoogleConfigured()) return;
    runSync().catch((err) => console.error("[google-sync]", err instanceof Error ? err.message : err));
  };
  const syncXunji = () => {
    import("@/lib/xunji")
      .then((m) => m.runXunjiSync({ days: 7 }))
      .catch((err) => console.error("[xunji-sync]", err instanceof Error ? err.message : err));
  };

  // 启动稍等片刻再同步，避免拖慢服务就绪；失败只记日志（详情在 google_sync_log / 状态页）。
  setTimeout(() => {
    import("@/lib/db")
      .then((m) => m.markInterruptedSyncLogs())
      .catch(() => {});
    syncGoogle();
    syncXunji();
  }, 5000).unref();

  if (Number.isFinite(minutes) && minutes > 0) {
    setInterval(() => {
      syncGoogle();
      // 训记也进小时级:fetch_log 幂等限流,长开的服务才能在当天拉到新练的课。
      syncXunji();
    }, minutes * 60_000).unref();
  }
}
