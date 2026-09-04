// 状态分区的展示元数据:颜色令牌(globals.css @theme)的唯一消费方。
// 集中在这里,避免同一分区色在组件里散落成各写各的 hex/类名。

import type { RecoveryZone } from "./recovery";
import type { AcwrZone, FormZone } from "./training-status";

export interface ZoneMeta {
  label: string;
  desc: string;
  text: string; // tailwind 文字色类
  border: string;
  bg: string;
  hex: string; // SVG 描边/发光用
}

export const RECOVERY_ZONE_META: Record<RecoveryZone, ZoneMeta> = {
  red: {
    label: "恢复不足",
    desc: "只安排轻松活动或休息",
    text: "text-zone-red",
    border: "border-zone-red/40",
    bg: "bg-zone-red/10",
    hex: "#ff5c5c",
  },
  yellow: {
    label: "恢复一般",
    desc: "可正常训练,避免冲极限",
    text: "text-zone-amber",
    border: "border-zone-amber/40",
    bg: "bg-zone-amber/10",
    hex: "#ffb224",
  },
  green: {
    label: "恢复良好",
    desc: "状态在线,可以上强度",
    text: "text-zone-green",
    border: "border-zone-green/40",
    bg: "bg-zone-green/10",
    hex: "#00e08c",
  },
};

export const ACWR_ZONE_META: Record<AcwrZone, ZoneMeta> = {
  under: {
    label: "欠训练",
    desc: "慢性负荷高于近期,有加量空间",
    text: "text-accent",
    border: "border-accent/40",
    bg: "bg-accent/10",
    hex: "#22d3ee",
  },
  optimal: {
    label: "最优区间",
    desc: "急性与慢性负荷匹配",
    text: "text-zone-green",
    border: "border-zone-green/40",
    bg: "bg-zone-green/10",
    hex: "#00e08c",
  },
  high: {
    label: "负荷偏高",
    desc: "短期冲量,不再加量",
    text: "text-zone-amber",
    border: "border-zone-amber/40",
    bg: "bg-zone-amber/10",
    hex: "#ffb224",
  },
  risk: {
    label: "急性峰值",
    desc: "相对平时突变,只做轻松恢复",
    text: "text-zone-red",
    border: "border-zone-red/40",
    bg: "bg-zone-red/10",
    hex: "#ff5c5c",
  },
};

export const FORM_ZONE_META: Record<FormZone, ZoneMeta> = {
  fresh: {
    label: "新鲜",
    desc: "疲劳已散,适合冲强度",
    text: "text-zone-green",
    border: "border-zone-green/40",
    bg: "bg-zone-green/10",
    hex: "#00e08c",
  },
  neutral: {
    label: "平衡",
    desc: "正常训练带",
    text: "text-zone-amber",
    border: "border-zone-amber/40",
    bg: "bg-zone-amber/10",
    hex: "#ffb224",
  },
  fatigued: {
    label: "疲劳积累",
    desc: "减量或安排恢复日",
    text: "text-zone-red",
    border: "border-zone-red/40",
    bg: "bg-zone-red/10",
    hex: "#ff5c5c",
  },
};
