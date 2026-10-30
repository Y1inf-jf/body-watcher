"use client";

// Next.js 16 全局错误边界：替代 root layout，必须自带 <html>/<body>。
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="zh-CN" className="dark">
      <body className="bg-bg text-ink min-h-dvh flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-semibold mb-2">应用发生严重错误</h2>
          <p className="text-ink-3 text-sm mb-6">
            {error.message || "未知错误"}
          </p>
          <button onClick={() => unstable_retry()} className="btn btn-primary">
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
