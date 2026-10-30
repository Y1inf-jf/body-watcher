// ScaleBar 刻度预设。阈值从 lib 复制(lib 未导出),修改算法时需同步。
import { ACWR_ZONE_META, RECOVERY_ZONE_META } from "@/lib/zone-meta";

export interface ScalePreset {
  min: number;
  max: number;
  segments?: { to: number; color: string }[];
  ticks?: { at: number; label: string }[];
  reference?: { at: number; label?: string };
}

// 阈值出处:src/lib/recovery.ts:514(<34 红 / <67 黄 / 其余绿)
export const RECOVERY_SCALE = {
  min: 0,
  max: 100,
  segments: [
    { to: 34, color: RECOVERY_ZONE_META.red.hex },
    { to: 67, color: RECOVERY_ZONE_META.yellow.hex },
    { to: 100, color: RECOVERY_ZONE_META.green.hex },
  ],
  ticks: [
    { at: 0, label: "0" },
    { at: 34, label: "34" },
    { at: 67, label: "67" },
    { at: 100, label: "100" },
  ],
  reference: { at: 50, label: "50" },
} satisfies ScalePreset;

// 阈值出处:src/lib/training-status.ts:176(<0.8 偏低 / ≤1.3 最优 / ≤1.5 偏高 / 其余急性峰值)
export const ACWR_SCALE = {
  min: 0,
  max: 2,
  segments: [
    { to: 0.8, color: ACWR_ZONE_META.under.hex },
    { to: 1.3, color: ACWR_ZONE_META.optimal.hex },
    { to: 1.5, color: ACWR_ZONE_META.high.hex },
    { to: 2, color: ACWR_ZONE_META.risk.hex },
  ],
  ticks: [
    { at: 0.8, label: "0.8" },
    { at: 1.3, label: "1.3" },
    { at: 1.5, label: "1.5" },
  ],
} satisfies ScalePreset;

// 睡眠需求范围 [300,720] 分钟(training-status.ts 的夹取区间);中性轨道不分段。
// 参照线(base)由调用方按当天 base 传入:reference={{ at: base }}。
export const SLEEP_SCALE = {
  min: 300,
  max: 720,
  ticks: [
    { at: 360, label: "6h" },
    { at: 480, label: "8h" },
    { at: 600, label: "10h" },
  ],
} satisfies ScalePreset;
