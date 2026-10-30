"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(j?.error ?? `登录失败(${res.status})`);
      setBusy(false);
    } catch {
      setError("网络错误,请重试");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[75dvh] max-w-sm flex-col justify-center">
      <form onSubmit={submit} className="animate-fade-up">
        <div className="mb-10 flex items-center gap-2.5">
          <span aria-hidden className="h-2 w-2 rounded-[2px] bg-ink" />
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ink">
            Body Watcher
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">输入访问密码</h1>
        <p className="mb-6 mt-2 text-sm text-ink-3">通过后 30 天内本浏览器免登录。</p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密码"
          aria-label="访问密码"
          className="field w-full"
        />
        {error && (
          <p role="alert" className="mt-2 text-xs text-zone-red">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || !password} className="btn btn-primary mt-4 w-full">
          {busy ? "验证中…" : "进入"}
        </button>
      </form>
    </div>
  );
}
