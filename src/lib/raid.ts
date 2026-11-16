// Shared harness for the raid modules (Chambers of Xeric, Tombs of Amascut).
//
// A raid's loot depends on the whole team's points, but the simulator follows one
// player: "you". Each module supplies a roller that plays one raid and reports your
// loot through `emit`. Rollers are made by a factory so that per-player state (such as
// ToA's kill-count-scaled tertiaries) starts fresh for every simulated player.

import type { Emit, LootLine, Rng } from './sim';

export interface RaidOutcome {
  /** Uniques the whole team got this raid (yours included). */
  teamUniques: number;
  /** Uniques you got this raid. */
  yourUniques: number;
}

/** Plays raid number `raid` (1-based) and emits your loot. */
export type RaidRoller = (rng: Rng, emit: Emit, raid: number) => RaidOutcome;
export type RollerFactory = () => RaidRoller;

export interface RaidTeam {
  /** Players in the raid, including you (1 = solo). */
  size: number;
  /** Your points. */
  you: number;
  /** The whole team's points, including yours. */
  total: number;
}

/** Normalises team inputs: total is at least your points, and others share the rest evenly. */
export function teamShape(t: RaidTeam): { size: number; you: number; total: number; other: number } {
  const size = Math.max(1, Math.round(t.size));
  const you = Math.max(0, t.you);
  const total = size === 1 ? you : Math.max(you, t.total);
  const other = size === 1 ? 0 : (total - you) / (size - 1);
  return { size, you, total, other };
}

/** Picks a player index weighted by points (0 = you), or -1 if nobody has any points. */
export function pickRecipient(rng: Rng, weights: readonly number[]): number {
  const sum = weights.reduce((a, w) => a + w, 0);
  if (sum <= 0) return -1;
  let r = rng() * sum;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/** Weighted pick from a list of entries with a `weight` field. */
export function pickWeighted<T extends { weight: number }>(rng: Rng, entries: readonly T[]): T {
  const sum = entries.reduce((a, e) => a + e.weight, 0);
  let r = rng() * sum;
  for (const e of entries) {
    r -= e.weight;
    if (r < 0) return e;
  }
  return entries[entries.length - 1];
}

export interface RaidResult {
  runs: number;
  loot: LootLine[];
  teamUniques: number;
  yourUniques: number;
  /** Raids in which you got at least one unique. */
  purpleRaids: number;
}

export function simulateRaids(factory: RollerFactory, runs: number, rng: Rng = Math.random): RaidResult {
  const roll = factory();
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
  let teamUniques = 0;
  let yourUniques = 0;
  let purpleRaids = 0;
  for (current = 1; current <= runs; current++) {
    const out = roll(rng, emit, current);
    teamUniques += out.teamUniques;
    yourUniques += out.yourUniques;
    if (out.yourUniques) purpleRaids++;
  }
  return { runs, loot: Array.from(loot.values()), teamUniques, yourUniques, purpleRaids };
}

/** Your GP over `runs` raids for many independent players, sorted ascending (for a luck percentile). */
export function raidValueSamples(factory: RollerFactory, runs: number, players: number, price: (n: string) => number, rng: Rng = Math.random): number[] {
  const out: number[] = [];
  let v = 0;
  const emit: Emit = (name, qty) => {
    v += qty * price(name);
  };
  for (let p = 0; p < players; p++) {
    const roll = factory();
    v = 0;
    for (let r = 1; r <= runs; r++) roll(rng, emit, r);
    out.push(v);
  }
  return out.sort((a, b) => a - b);
}
