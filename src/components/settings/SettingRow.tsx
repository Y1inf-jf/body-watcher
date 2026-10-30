import type { ReactNode } from "react";

// 设置项行:左标签+说明,右控件;行间发丝线
export function SettingRow({
  label,
  htmlFor,
  desc,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  desc?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-x-8 gap-y-2 border-t border-line py-4 first:border-t-0 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
            {label}
          </label>
        ) : (
          <span className="text-sm font-medium text-ink">{label}</span>
        )}
        {desc && <p className="mt-1 text-xs leading-relaxed text-ink-3">{desc}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// 分节操作行:与控件列对齐,反馈紧跟按钮
export function SettingActions({
  children,
  feedback,
}: {
  children: ReactNode;
  feedback?: ReactNode;
}) {
  return (
    <div className="grid gap-x-8 border-t border-line pt-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <div className="hidden sm:block" />
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-3">{children}</div>
        {feedback}
      </div>
    </div>
  );
}
