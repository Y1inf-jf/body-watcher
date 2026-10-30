// Recharts 的 SVG 属性里不能写 var(),这里用 hex 常量。
// 必须与 globals.css 的 @theme 色板同步。

export const CHART = {
  grid: "#262522", // --color-line
  tick: { fontSize: 10, fill: "#85807a" }, // --color-ink-3
  tooltip: {
    contentStyle: {
      backgroundColor: "#141412", // --color-surface
      border: "1px solid #36352f", // --color-line-strong
      borderRadius: 6,
      fontSize: 12,
      color: "#ece8e1", // --color-ink
    },
    labelStyle: { color: "#aaa59c" }, // --color-ink-2
    cursor: { stroke: "#36352f" },
  },
  series: {
    primary: "#ece8e1", // --color-ink
    secondary: "#8fa9c9", // --color-accent
    muted: "#85807a", // --color-ink-3
  },
} as const;
