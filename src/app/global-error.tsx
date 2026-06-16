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
      <body className="bg-zinc-950 text-zinc-100 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-bold mb-2">应用发生严重错误</h2>
          <p className="text-zinc-500 text-sm mb-6">
            {error.message || "未知错误"}
          </p>
          <button
            onClick={() => unstable_retry()}
            className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm font-medium"
          >
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
