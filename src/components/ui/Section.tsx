import { useId, type ReactNode } from "react";

// 分节:序号 + 标题 + 右侧辅助信息,发丝线分隔。
export default function Section({
  index,
  title,
  aside,
  className,
  children,
}: {
  index?: string;
  title: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={className}>
      <header className="mb-5 flex items-baseline justify-between gap-3 border-b border-line pb-3">
        <h2 id={id} className="text-sm font-medium text-ink">
          {index && (
            <span className="mr-2 font-mono text-[11px] text-ink-3">
              {index}
            </span>
          )}
          {title}
        </h2>
        {aside && (
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
            {aside}
          </div>
        )}
      </header>
      {children}
    </section>
  );
}
