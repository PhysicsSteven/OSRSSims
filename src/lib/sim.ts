// The Monte Carlo engine: rolls kills (or caskets) against a DropSource.

import type { DropSource, Leaf, Outcome, Pool } from './model';

export type Rng = () => number;

/** Small fast seeded generator (mulberry32), so runs can be repeated from a seed. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function sampleQty(leaf: Leaf, rng: Rng): number {
  const opts = leaf.quantity.options;
  const [a, b] = opts.length === 1 ? opts[0] : opts[Math.floor(rng() * opts.length)];
  return a === b ? a : randInt(rng, a, b);
}

export type Emit = (name: string, qty: number) => void;

function rollPool(pool: Pool, rng: Rng, emit: Emit, depth = 0): void {
  const r = rng();
  const cum = pool.cumulative;
  if (!cum.length || r >= cum[cum.length - 1]) return; // nothing
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (r < cum[mid]) hi = mid;
    else lo = mid + 1;
  }
  emitOutcome(pool.outcomes[lo], rng, emit, depth);
}

function emitOutcome(o: Outcome, rng: Rng, emit: Emit, depth: number): void {
  if (o.leaf) emit(o.leaf.name, sampleQty(o.leaf, rng));
  else if (o.sub && depth < 6) rollPool(o.sub, rng, emit, depth + 1);
}

/** Rolls one kill or casket and reports every item through emit. */
export function rollOnce(src: DropSource, rng: Rng, emit: Emit): void {
  for (const leaf of src.always) emit(leaf.name, sampleQty(leaf, rng));
  const rolls = src.mainRolls.min === src.mainRolls.max ? src.mainRolls.min : randInt(rng, src.mainRolls.min, src.mainRolls.max);
  for (let i = 0; i < rolls; i++) rollPool(src.main, rng, emit);
  for (const ind of src.independent) {
    for (let i = 0; i < ind.rolls; i++) if (rng() < ind.p) emitOutcome(ind.outcome, rng, emit, 0);
  }
}

export interface LootLine {
  name: string;
  qty: number;
  drops: number;
  /** Kill (or casket) number of the first drop. */
  first: number;
}

export interface SimResult {
  units: number;
  loot: Map<string, LootLine>;
}

export function simulate(src: DropSource, units: number, rng: Rng = Math.random): SimResult {
  const loot = new Map<string, LootLine>();
  let current = 0;
  const emit: Emit = (name, qty) => {
    let line = loot.get(name);
    if (!line) {
      line = { name, qty: 0, drops: 0, first: current };
      loot.set(name, line);
    }
    line.qty += qty;
    line.drops += 1;
  };
  for (current = 1; current <= units; current++) rollOnce(src, rng, emit);
  return { units, loot };
}

/**
 * Rolls until every named item has dropped at least once. Returns the number of kills
 * (or caskets) it took, or null if it did not finish within maxUnits.
 */
export function unitsToComplete(src: DropSource, items: string[], rng: Rng = Math.random, maxUnits = 5_000_000): number | null {
  const missing = new Set(items);
  if (!missing.size) return 0;
  const emit: Emit = (name) => {
    missing.delete(name);
  };
  for (let n = 1; n <= maxUnits; n++) {
    rollOnce(src, rng, emit);
    if (missing.size === 0) return n;
  }
  return null;
}

/** Like simulate, but keeps going until every named item has dropped (or maxUnits). */
export function simulateUntilComplete(src: DropSource, items: string[], rng: Rng = Math.random, maxUnits = 5_000_000): SimResult & { complete: boolean } {
  const loot = new Map<string, LootLine>();
  const missing = new Set(items);
  let current = 0;
  const emit: Emit = (name, qty) => {
    let line = loot.get(name);
    if (!line) {
      line = { name, qty: 0, drops: 0, first: current };
      loot.set(name, line);
    }
    line.qty += qty;
    line.drops += 1;
    missing.delete(name);
  };
  for (current = 1; current <= maxUnits; current++) {
    rollOnce(src, rng, emit);
    if (missing.size === 0) return { units: current, loot, complete: true };
  }
  return { units: maxUnits, loot, complete: false };
}

/** Total GP of a run. */
export function lootValue(loot: Iterable<LootLine>, price: (name: string) => number): number {
  let v = 0;
  for (const l of loot) v += l.qty * price(l.name);
  return v;
}

/** GP totals of many independent runs of `units` kills, sorted ascending. */
export function valueSamples(src: DropSource, units: number, runs: number, price: (name: string) => number, rng: Rng = Math.random): number[] {
  const out: number[] = [];
  for (let r = 0; r < runs; r++) {
    let v = 0;
    const emit: Emit = (name, qty) => {
      v += qty * price(name);
    };
    for (let i = 0; i < units; i++) rollOnce(src, rng, emit);
    out.push(v);
  }
  return out.sort((a, b) => a - b);
}
