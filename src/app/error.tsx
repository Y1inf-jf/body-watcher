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
      <h2 className="text-lg font-bold text-zinc-200 mb-2">页面出错了</h2>
      <p className="text-zinc-500 text-sm mb-6">
        {error.message || "发生未知错误"}
      </p>
      <button
        onClick={() => unstable_retry()}
        className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm font-medium"
      >
        重试
      </button>
    </div>
  );
}
