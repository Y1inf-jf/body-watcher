"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { CHART } from "./ui/chart-theme";

interface DataPoint {
  date: string;
  [key: string]: string | number | null;
}

interface Series {
  dataKey: string;
  color: string;
  name: string;
}

interface TrendChartProps {
  title: string;
  data: DataPoint[];
  series: Series[];
  unit?: string;
}

// 通用趋势图:细线折线,头部显示首个系列的最新值。
export default function TrendChart({ title, data, series, unit }: TrendChartProps) {
  // 首个系列最新的非空值
  const first = series[0]?.dataKey;
  let latest: string | number | null = null;
  if (first) {
    for (let i = data.length - 1; i >= 0; i--) {
      const v = data[i][first];
      if (v !== null && v !== undefined) {
        latest = v;
        break;
      }
    }
  }

  return (
    <figure className="min-w-0 animate-fade-up">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <figcaption className="text-sm text-ink">{title}</figcaption>
        {latest !== null && (
          <span className="font-mono text-xl tabular-nums text-ink">
            {latest}
            {unit && <span className="ml-1 text-xs text-ink-3">{unit}</span>}
          </span>
        )}
      </div>
      {!data.length ? (
        <p className="text-sm text-ink-3">暂无数据</p>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={data}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(d) => String(d).slice(5)}
              minTickGap={24}
              tick={CHART.tick}
              axisLine={false}
              tickLine={false}
            />
            <YAxis tick={CHART.tick} width={32} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
            <Tooltip {...CHART.tooltip} />
            {series.map((s) => (
              <Line
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                stroke={s.color}
                name={s.name}
                strokeWidth={1.5}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </figure>
  );
}
