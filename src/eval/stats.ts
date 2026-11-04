// The two statistics the report needs, written out so each line can be explained.

export interface Interval {
  low: number;
  high: number;
}

// Wilson score interval for a proportion k/n. Better than "p ± 1.96·SE" for
// small samples and rates near 0% or 100%, where that formula can go below 0
// or above 1. z = 1.96 gives a 95% interval.
export function wilson(k: number, n: number, z = 1.96): Interval {
  if (n === 0) return { low: 0, high: 1 };
  const p = k / n;
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z / (1 + z2 / n)) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

function choose(n: number, k: number): number {
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return result;
}

// Exact McNemar test for paired pass/fail results.
// v1 and v2 run the same scenarios, so only the scenarios where they disagree
// carry information: b = passed in v1 but failed in v2 (regressions),
// c = failed in v1 but passed in v2 (fixes). If v2 were no better, each
// disagreement would be a coin flip, so we ask how likely a split at least as
// lopsided as b vs c is under Binomial(b + c, 0.5). Two-sided.
export function mcnemarExact(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += choose(n, i);
  return Math.min(1, (2 * tail) / 2 ** n);
}
