"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole } from "lucide-react";

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
    <div className="flex min-h-screen flex-1 items-center justify-center p-6">
      <form onSubmit={submit} className="panel animate-fade-up w-full max-w-sm p-8">
        <div className="mb-7 flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-50" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
          </span>
          <h1 className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-zinc-100">
            Body Watcher
          </h1>
        </div>
        <div className="mb-1 flex items-center gap-2 text-sm text-zinc-300">
          <LockKeyhole size={15} strokeWidth={1.8} /> 输入访问密码
        </div>
        <p className="mb-5 text-xs text-zinc-600">通过后 30 天内本浏览器免登录。</p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密码"
          className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
        />
        {error && <p className="mt-2 text-xs text-zone-red">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="mt-4 w-full rounded-lg bg-accent/90 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-accent disabled:opacity-40"
        >
          {busy ? "验证中…" : "进入"}
        </button>
      </form>
    </div>
  );
}
