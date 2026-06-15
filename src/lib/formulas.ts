// 1RM (One-Rep Maximum) 估算公式集合。
// 所有公式接受重量(kg)和次数(reps)，返回估算 1RM(kg)。
// 纯函数，无副作用，无依赖，可在前后端通用。

export type FormulaKey = "epley" | "brzycki" | "lombardi";

// reps 超过此值时，所有 1RM 公式准确度下降（约 ±）。
export const LOW_ACCURACY_THRESHOLD = 10;

// Brzycki 公式分母为 (37 - reps)，reps 达到 37 时分母为 0，无意义。
const BRZYCKI_INVALID_REPS = 37;

type Formula = {
  label: string;
  compute: (weight: number, reps: number) => number | null;
};

export const FORMULAS: Record<FormulaKey, Formula> = {
  // Epley: 1RM = w * (1 + r/30)，最常用，适合中低次数。
  epley: {
    label: "Epley",
    compute: (w, r) => (r > 0 ? w * (1 + r / 30) : null),
  },
  // Brzycki: 1RM = w * 36 / (37 - r)，对低次数更准，但 r>=37 失效。
  brzycki: {
    label: "Brzycki",
    compute: (w, r) => (r > 0 && r < BRZYCKI_INVALID_REPS ? (w * 36) / (37 - r) : null),
  },
  // Lombardi: 1RM = w * r^0.10，对高次数相对温和。
  lombardi: {
    label: "Lombardi",
    compute: (w, r) => (r > 0 ? w * Math.pow(r, 0.1) : null),
  },
};

/**
 * 按指定公式计算 1RM。
 * weight 或 reps 缺失/非正时返回 null。
 */
export function compute1RM(
  weight: number | null | undefined,
  reps: number | null | undefined,
  formula: FormulaKey
): number | null {
  if (!weight || weight <= 0 || !reps || reps <= 0) return null;
  return FORMULAS[formula].compute(weight, reps);
}
