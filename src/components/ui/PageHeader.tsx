import type { ReactNode } from "react";

// 页面标题:h1 + 一行说明,右侧可放操作。
export default function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line pb-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink md:text-[28px]">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 text-sm text-ink-3">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
