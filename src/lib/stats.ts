// Luck and probability maths.

import { meanQuantity, meanSquareQuantity } from './parseText';
import type { DropSource, ItemRate, Leaf, Outcome, Pool } from './model';

export function normalCdf(z: number): number {
  // Abramowitz and Stegun 7.1.26 via erf, accurate to about 1e-7.
  const t = 1 / (1 + 0.3275911 * Math.abs(z / Math.SQRT2));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

function logGamma(x: number): number {
  // Lanczos approximation.
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Returns [P(X < k), P(X = k)] for the count of an item over `units` kills. */
export function countProbabilities(rate: ItemRate, units: number, k: number): [number, number] {
  const mean = rate.routes.reduce((a, r) => a + units * r.trials * r.p, 0);
  const variance = rate.routes.reduce((a, r) => a + units * r.trials * r.p * (1 - r.p), 0);
  if (mean <= 0) return [0, k === 0 ? 1 : 0];
  const single = rate.routes.length === 1 && Number.isInteger(rate.routes[0].trials) ? rate.routes[0] : null;
  if (k <= 20000 && mean <= 20000) {
    // Exact binomial for a single route, Poisson for a sum of rare routes.
    let logPmf: (i: number) => number;
    if (single) {
      const n = Math.round(units * single.trials);
      const p = single.p;
      if (p >= 1) return [k > n ? 1 : 0, k === n ? 1 : 0];
      const lgN = logGamma(n + 1);
      logPmf = (i) => (i > n ? -Infinity : lgN - logGamma(i + 1) - logGamma(n - i + 1) + i * Math.log(p) + (n - i) * Math.log1p(-p));
    } else {
      logPmf = (i) => -mean + i * Math.log(mean) - logGamma(i + 1);
    }
    let below = 0;
    for (let i = 0; i < k; i++) below += Math.exp(logPmf(i));
    return [Math.min(1, below), Math.exp(logPmf(k))];
  }
  const sd = Math.sqrt(variance) || 1;
  const lo = normalCdf((k - 0.5 - mean) / sd);
  const hi = normalCdf((k + 0.5 - mean) / sd);
  return [lo, hi - lo];
}

/** Share of players who would have got fewer of this item than you (ties split): higher is luckier. */
export function luckPercentile(rate: ItemRate, units: number, k: number): number {
  const [below, at] = countProbabilities(rate, units, k);
  return Math.max(0, Math.min(1, below + at / 2));
}

/** Chance that at least one of the item has dropped within `units` kills. */
export function chanceByNow(rate: ItemRate, units: number): number {
  const logNone = rate.routes.reduce((a, r) => a + units * r.trials * Math.log1p(-Math.min(r.p, 1 - 1e-15)), 0);
  return 1 - Math.exp(logNone);
}

export type PriceOf = (name: string) => number;

interface Moments {
  m1: number;
  m2: number;
}

function leafMoments(leaf: Leaf, price: PriceOf): Moments {
  const v = price(leaf.name);
  return { m1: v * meanQuantity(leaf.quantity), m2: v * v * meanSquareQuantity(leaf.quantity) };
}

function outcomeMoments(o: Outcome, price: PriceOf): Moments {
  if (o.leaf) return leafMoments(o.leaf, price);
  if (o.sub) return poolMoments(o.sub, price);
  return { m1: 0, m2: 0 };
}

function poolMoments(pool: Pool, price: PriceOf): Moments {
  let m1 = 0;
  let m2 = 0;
  for (const o of pool.outcomes) {
    const m = outcomeMoments(o, price);
    const p = o.p * pool.scaledBy;
    m1 += p * m.m1;
    m2 += p * m.m2;
  }
  return { m1, m2 };
}

/** Mean and variance of GP per kill (or casket). */
export function valueMoments(src: DropSource, price: PriceOf): { mean: number; variance: number } {
  let mean = 0;
  let variance = 0;
  for (const leaf of src.always) {
    const m = leafMoments(leaf, price);
    mean += m.m1;
    variance += m.m2 - m.m1 * m.m1;
  }
  const roll = poolMoments(src.main, price);
  const { min, max } = src.mainRolls;
  const n = max - min + 1;
  const er = (min + max) / 2;
  const varR = (n * n - 1) / 12;
  mean += er * roll.m1;
  variance += er * (roll.m2 - roll.m1 * roll.m1) + varR * roll.m1 * roll.m1;
  for (const ind of src.independent) {
    const m = outcomeMoments(ind.outcome, price);
    const e1 = ind.p * m.m1;
    mean += ind.rolls * e1;
    variance += ind.rolls * (ind.p * m.m2 - e1 * e1);
  }
  return { mean, variance: Math.max(0, variance) };
}

/** Percentile of a value among sorted samples (ties split). */
export function percentileOf(sorted: number[], v: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  let eq = lo;
  while (eq < sorted.length && sorted[eq] === v) eq++;
  return (lo + (eq - lo) / 2) / sorted.length;
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[i];
}
