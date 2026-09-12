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
  // 返回 promise,供"同步完 → 重算洞察"编排。
  const syncGoogle = () => {
    if (!isGoogleConfigured()) return Promise.resolve();
    return runSync().catch((err) => console.error("[google-sync]", err instanceof Error ? err.message : err));
  };
  // 同 syncGoogle:必须返回 promise,否则 Promise.allSettled 不会等它,
  // 洞察会在训记数据落库前重算(用旧训练数据),要等下一个小时级定时器才自愈。
  const syncXunji = () => {
    return import("@/lib/xunji")
      .then((m) => m.runXunjiSync({ days: 7 }))
      .catch((err) => console.error("[xunji-sync]", err instanceof Error ? err.message : err));
  };
  // 洞察在数据落库后才有意义;失败只记日志,不影响同步本身。
  const recomputeInsights = () => {
    import("@/lib/insights")
      .then((m) => m.computeInsights())
      .catch((err) => console.error("[insights]", err instanceof Error ? err.message : err));
  };

  // 启动稍等片刻再同步，避免拖慢服务就绪；失败只记日志（详情在 google_sync_log / 状态页）。
  setTimeout(() => {
    import("@/lib/db")
      .then((m) => m.markInterruptedSyncLogs())
      .catch(() => {});
    Promise.allSettled([syncGoogle(), syncXunji()]).then(() => recomputeInsights());
  }, 5000).unref();

  if (Number.isFinite(minutes) && minutes > 0) {
    setInterval(() => {
      // 训记也进小时级:fetch_log 幂等限流,长开的服务才能在当天拉到新练的课。
      Promise.allSettled([syncGoogle(), syncXunji()]).then(() => recomputeInsights());
    }, minutes * 60_000).unref();
  }
}
