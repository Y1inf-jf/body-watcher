// 线性刻度条:分段轨道 + 当前值标记 + 可选参照线与刻度文字。
export default function ScaleBar({
  min,
  max,
  value,
  segments,
  ticks,
  reference,
  label,
  valueText,
  className = "",
}: {
  min: number;
  max: number;
  value: number | null;
  segments?: { to: number; color: string }[];
  ticks?: { at: number; label: string }[];
  reference?: { at: number; label?: string };
  label: string;
  valueText?: string;
  className?: string;
}) {
  const span = max - min;
  const pctOf = (v: number) =>
    Math.min(100, Math.max(0, ((v - min) / span) * 100));
  const hasValue = value !== null;
  const overflow = hasValue && value > max;

  // 分段按区间宽度比例伸展,当前值所在段高亮
  const segs = segments ?? [{ to: max, color: "#85807a" }];
  const parts = segs.map((s, i) => {
    const from = i === 0 ? min : segs[i - 1].to;
    const active = hasValue && value >= from && (value < s.to || s.to >= max);
    return { from, to: s.to, color: s.color, active };
  });

  // 位于 min 的刻度左对齐,位于 max 的右对齐,其余居中
  const tickStyle = (at: number) => {
    if (at <= min) return { left: 0 };
    if (at >= max) return { right: 0 };
    return { left: `${pctOf(at)}%`, transform: "translateX(-50%)" };
  };

  return (
    <div className={className}>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={hasValue ? value : undefined}
        aria-valuetext={hasValue ? valueText : "无数据"}
        className="relative flex h-1.5 items-center"
      >
        <div
          className="flex h-full min-w-0 flex-1 gap-[2px]"
          style={{ opacity: hasValue ? 1 : 0.15 }}
        >
          {parts.map((p) => (
            <div
              key={p.from}
              className="h-full rounded-[1px]"
              style={{
                flexGrow: p.to - p.from,
                flexBasis: 0,
                backgroundColor: p.color,
                opacity: p.active ? 0.9 : 0.28,
              }}
            />
          ))}
        </div>
        {reference && (
          <span
            aria-hidden
            className="absolute top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-ink-3"
            style={{ left: `${pctOf(reference.at)}%` }}
          />
        )}
        {hasValue && (
          <span
            aria-hidden
            className="absolute top-1/2 h-4 w-[3px] -translate-x-1/2 -translate-y-1/2 bg-ink ring-2 ring-bg transition-[left] duration-700 motion-reduce:transition-none"
            style={{ left: `${pctOf(value)}%` }}
          />
        )}
        {overflow && (
          <span
            aria-hidden
            className="absolute -right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-ink-3"
          >
            ›
          </span>
        )}
      </div>
      {(ticks?.length || reference?.label) && (
        <div aria-hidden className="relative mt-1.5 h-3">
          {ticks?.map((t) => (
            <span
              key={t.at}
              className="absolute font-mono text-[10px] leading-3 text-ink-3"
              style={tickStyle(t.at)}
            >
              {t.label}
            </span>
          ))}
          {reference?.label && (
            <span
              className="absolute font-mono text-[10px] leading-3 text-ink-2"
              style={tickStyle(reference.at)}
            >
              {reference.label}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
