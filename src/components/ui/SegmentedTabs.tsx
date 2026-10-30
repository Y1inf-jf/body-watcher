"use client";

import { useRef, type KeyboardEvent } from "react";
import type { LucideIcon } from "lucide-react";

export interface TabDef<K extends string> {
  key: K;
  label: string;
  icon?: LucideIcon;
}

// 与 SegmentedTabs 配对:展开到对应面板容器上,补全 role/id/aria-labelledby。
export function tabPanelProps(idBase: string, key: string) {
  return {
    role: "tabpanel" as const,
    id: `${idBase}-panel-${key}`,
    "aria-labelledby": `${idBase}-tab-${key}`,
    tabIndex: 0 as const,
  };
}

export default function SegmentedTabs<K extends string>({
  tabs,
  value,
  onChange,
  idBase,
}: {
  tabs: readonly TabDef<K>[];
  value: K;
  onChange: (k: K) => void;
  idBase: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent, i: number) => {
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    onChange(tabs[next].key);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      className="flex gap-6 overflow-x-auto overflow-y-hidden border-b border-line"
    >
      {tabs.map((t, i) => {
        const active = t.key === value;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${idBase}-tab-${t.key}`}
            aria-controls={`${idBase}-panel-${t.key}`}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`relative -mb-px inline-flex h-11 shrink-0 items-center gap-1.5 text-sm transition-colors ${
              active
                ? "text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-ink"
                : "text-ink-3 hover:text-ink-2"
            }`}
          >
            {Icon && <Icon size={14} strokeWidth={1.8} />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
