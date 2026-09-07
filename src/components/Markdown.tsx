"use client";

import ReactMarkdown from "react-markdown";

// AI 教练输出的 Markdown 渲染。输出格式受系统提示约束(小标题分段 + 列表 + 粗体),
// 这里按暗色主题定制各级样式;不启用 GFM(教练不会输出表格/脚注)。
export default function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      components={{
        h1: (p) => <h1 className="mb-2 mt-4 text-base font-bold text-zinc-50 first:mt-0" {...p} />,
        h2: (p) => <h2 className="mb-1.5 mt-4 text-sm font-bold tracking-wide text-accent first:mt-0" {...p} />,
        h3: (p) => <h3 className="mb-1 mt-3 text-sm font-semibold text-zinc-100 first:mt-0" {...p} />,
        p: (p) => <p className="my-2 text-sm leading-relaxed text-zinc-300 first:mt-0 last:mb-0" {...p} />,
        strong: (p) => <strong className="font-semibold text-zinc-50" {...p} />,
        em: (p) => <em className="text-zinc-400" {...p} />,
        ul: (p) => <ul className="my-2 list-disc space-y-1 pl-5" {...p} />,
        ol: (p) => <ol className="my-2 list-decimal space-y-1 pl-5" {...p} />,
        li: (p) => <li className="text-sm leading-relaxed text-zinc-300" {...p} />,
        hr: () => <hr className="my-3 border-white/10" />,
        blockquote: (p) => (
          <blockquote className="my-2 border-l-2 border-accent/60 pl-3 text-sm text-zinc-400" {...p} />
        ),
        code: (p) => <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[13px] text-zone-green" {...p} />,
        a: (p) => <a className="text-accent underline underline-offset-2" target="_blank" rel="noreferrer" {...p} />,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
