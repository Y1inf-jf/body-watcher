import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

// 原生 <details> 折叠块。actions 放在 summary 右侧(按钮点击需自行 preventDefault/stopPropagation)。
export default function Disclosure({
  summary,
  meta,
  actions,
  open,
  className = "",
  children,
}: {
  summary: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  open?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details open={open} className={`group ${className}`}>
      <summary className="flex cursor-pointer list-none items-center gap-2 py-3 text-sm text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight
          size={14}
          strokeWidth={1.8}
          className="shrink-0 text-ink-3 transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
        <span className="min-w-0 flex-1">{summary}</span>
        {meta && <span className="text-xs text-ink-3">{meta}</span>}
        {actions && (
          <span className="flex shrink-0 items-center gap-1">{actions}</span>
        )}
      </summary>
      <div className="pb-4 pl-6">{children}</div>
    </details>
  );
}
