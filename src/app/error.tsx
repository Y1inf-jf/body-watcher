"use client";

import { useEffect } from "react";

// Next.js 16 路由级错误边界：捕获渲染期未处理异常，提供重试。
// 注意 16 的签名是 unstable_retry（替代旧版的 reset）。
export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="max-w-2xl mx-auto py-16 text-center">
      <h2 className="text-lg font-semibold text-ink mb-2">页面出错了</h2>
      <p className="text-ink-3 text-sm mb-6">
        {error.message || "发生未知错误"}
      </p>
      <button onClick={() => unstable_retry()} className="btn btn-primary">
        重试
      </button>
    </div>
  );
}
