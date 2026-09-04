"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardTitle } from "./ui/Card";

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
}

// 通用趋势图:渐变面积曲线,配色与仪表盘状态色统一。
export default function TrendChart({ title, data, series }: TrendChartProps) {
  return (
    <Card className="animate-fade-up p-4">
      <CardTitle className="mb-3">{title}</CardTitle>
      {!data.length ? (
        <p className="text-sm text-zinc-600">暂无数据</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data}>
            <defs>
              {series.map((s) => (
                <linearGradient key={s.dataKey} id={`grad-${s.dataKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 6" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#71717a" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#71717a" }}
              width={40}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#101014",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8,
                fontSize: 12,
              }}
              cursor={{ stroke: "rgba(255,255,255,0.15)" }}
            />
            {series.map((s) => (
              <Area
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                stroke={s.color}
                fill={`url(#grad-${s.dataKey})`}
                name={s.name}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
