// Doom of Mokhaiotl: a delve boss whose loot does not fit the normal drop-table model.
//
// Each delve level you clear adds loot to a pile: one common roll, one unique roll,
// a pet roll, a clue roll and (from delve 3) a fixed stack of demon tears. Unique and
// pet rates improve with depth until delve 9, and common quantities scale with depth.
// After any level you can leave and claim the pile, or delve deeper. Dying to the boss
// forfeits the whole pile, so the interesting question is how deep to go.
//
// The wiki page puts these rates in per-level tables and formulas rather than in an
// item-drops table, so they are kept here by hand. Sources: OSRS Wiki "Doom of Mokhaiotl"
// page (checked 2026-11-16), cross-checked against osrsplan.com and bald.gg.

import type { Emit, LootLine, Rng } from './sim';

export const DOOM_TITLE = 'Doom of Mokhaiotl';
export const DOOM_ALIASES = /^(the )?doom( of mokhaiotl)?$/i;

/** Levels past this one all use the delve 9 rates. */
export const MAX_RATE_LEVEL = 9;

const at = <T>(arr: readonly T[], level: number): T => arr[Math.min(level, MAX_RATE_LEVEL) - 1];

export const CLOTH = 'Mokhaiotl cloth';
export const EYE = 'Eye of ayak (uncharged)';
export const TREADS = 'Avernic treads';
export const PET = 'Dom';
export const TEARS = 'Demon tear';
export const CLUE = 'Clue scroll (elite)';

/** Denominator of each unique's chance per level cleared, delves 1–9 (0 = cannot drop). */
export const UNIQUE_DENOMS: Record<string, readonly number[]> = {
  [CLOTH]: [0, 2500, 2000, 1350, 810, 765, 720, 630, 540],
  [EYE]: [0, 0, 2000, 1350, 810, 765, 720, 630, 540],
  [TREADS]: [0, 0, 0, 1350, 810, 765, 720, 630, 540],
};
export const UNIQUE_NAMES = [CLOTH, EYE, TREADS];

export const PET_DENOMS: readonly number[] = [0, 0, 0, 0, 0, 1000, 750, 500, 250];

/** Common quantities are listed for delve 3; other delves add trunc(q × this). */
export const QTY_MULT: readonly number[] = [-0.5, -0.35, 0, 0.05, 0.1, 0.12, 0.14, 0.17, 0.2];

export interface CommonEntry {
  name: string;
  min: number;
  max: number;
  /** Weight out of 312 (the table is listed in 104ths, sharks in 312ths). */
  weight: number;
  noted?: boolean;
  /** Shark lures only come in even amounts. */
  even?: boolean;
}

export const COMMON: readonly CommonEntry[] = [
  { name: 'Dragon med helm', min: 1, max: 1, weight: 15, noted: true },
  { name: 'Dragon platelegs', min: 2, max: 4, weight: 3, noted: true },
  { name: 'Mystic earth staff', min: 1, max: 1, weight: 15, noted: true },
  { name: 'Rune pickaxe', min: 1, max: 3, weight: 15, noted: true },
  { name: 'Death rune', min: 50, max: 70, weight: 15 },
  { name: 'Chaos rune', min: 50, max: 70, weight: 15 },
  { name: 'Earth rune', min: 500, max: 1000, weight: 15 },
  { name: 'Fire rune', min: 500, max: 1000, weight: 15 },
  { name: 'Steel cannonball', min: 200, max: 600, weight: 15 },
  { name: 'Onyx bolts', min: 5, max: 15, weight: 15 },
  { name: 'Coal', min: 15, max: 50, weight: 15, noted: true },
  { name: 'Gold ore', min: 20, max: 60, weight: 15, noted: true },
  { name: 'Runite ore', min: 3, max: 6, weight: 15, noted: true },
  { name: 'Celastrus seed', min: 1, max: 1, weight: 9 },
  { name: 'Ranarr seed', min: 1, max: 3, weight: 6 },
  { name: 'Spirit seed', min: 1, max: 1, weight: 9 },
  { name: 'Aether catalyst', min: 151, max: 400, weight: 15 },
  { name: 'Dragon dart tip', min: 30, max: 90, weight: 15 },
  { name: 'Raw shark', min: 20, max: 35, weight: 10, noted: true },
  { name: 'Shark lure', min: 40, max: 70, weight: 5, even: true },
  { name: 'Sun-kissed bones', min: 18, max: 75, weight: 15 },
  { name: TEARS, min: 100, max: 300, weight: 21 },
  { name: 'Mokhaiotl waystone', min: 1, max: 2, weight: 21 },
  { name: 'Tooth half of key', min: 1, max: 1, weight: 3 },
];
export const COMMON_TOTAL = 312;

/** Demon tears handed out for clearing a level, on top of the common roll. */
export function guaranteedTears(level: number): number {
  return level < 3 ? 0 : Math.min(100, 50 + 10 * (level - 3));
}

export function clueChance(level: number): number {
  return level <= 2 ? 1 / 75 : 1 / 50;
}

export function uniqueChance(name: string, level: number): number {
  const d = at(UNIQUE_DENOMS[name], level);
  return d ? 1 / d : 0;
}

export function anyUniqueChance(level: number): number {
  return UNIQUE_NAMES.reduce((a, n) => a + uniqueChance(n, level), 0);
}

export function petChance(level: number): number {
  const d = at(PET_DENOMS, level);
  return d ? 1 / d : 0;
}

export function scaleQty(q: number, level: number): number {
  return Math.max(1, q + Math.trunc(q * at(QTY_MULT, level)));
}

/** Every base quantity a common entry can roll, each equally likely. */
function baseQuantities(e: CommonEntry): number[] {
  const out: number[] = [];
  for (let q = e.min; q <= e.max; q++) if (!e.even || q % 2 === 0) out.push(q);
  return out;
}

const BASE_QTYS = COMMON.map(baseQuantities);

export function meanCommonQty(index: number, level: number): number {
  const qs = BASE_QTYS[index];
  return qs.reduce((a, q) => a + scaleQty(q, level), 0) / qs.length;
}

/** Death chance at each delve 1–9 (the last also covers deeper levels), as fractions. */
export type DeathChances = readonly number[];

export interface DoomStrategy {
  /** Claim the pile after clearing this delve level. */
  claimAfter: number;
  /** Also claim straight away once a unique is in the pile (the game warns you). */
  stopOnUnique: boolean;
  death: DeathChances;
}

export const deathAt = (death: DeathChances, level: number): number => Math.max(0, Math.min(1, at(death, level) ?? 0));

/** Rolls the loot for clearing one delve level. Returns true if a unique (not the pet) dropped. */
export function rollLevel(level: number, rng: Rng, emit: Emit): boolean {
  // Common roll.
  let r = rng() * COMMON_TOTAL;
  for (let i = 0; i < COMMON.length; i++) {
    r -= COMMON[i].weight;
    if (r < 0) {
      const qs = BASE_QTYS[i];
      emit(COMMON[i].name, scaleQty(qs[Math.floor(rng() * qs.length)], level));
      break;
    }
  }
  // Unique roll: the three uniques share one roll, so at most one per level.
  let unique = false;
  let u = rng();
  for (const name of UNIQUE_NAMES) {
    u -= uniqueChance(name, level);
    if (u < 0) {
      emit(name, 1);
      unique = true;
      break;
    }
  }
  if (rng() < petChance(level)) emit(PET, 1);
  if (rng() < clueChance(level)) emit(CLUE, 1);
  const tears = guaranteedTears(level);
  if (tears) emit(TEARS, tears);
  return unique;
}

export interface DoomRunOutcome {
  /** Levels whose loot made it into the pile. */
  cleared: number;
  died: boolean;
  gotUnique: boolean;
}

/**
 * Plays one run: clear levels until the strategy says claim, or until death.
 * Loot goes to `pile` as it drops; the caller decides what to do with it on death.
 */
export function playRun(s: DoomStrategy, rng: Rng, pile: Emit): DoomRunOutcome {
  let gotUnique = false;
  for (let level = 1; level <= s.claimAfter; level++) {
    if (rng() < deathAt(s.death, level)) return { cleared: level - 1, died: true, gotUnique };
    if (rollLevel(level, rng, pile)) gotUnique = true;
    if (gotUnique && s.stopOnUnique) return { cleared: level, died: false, gotUnique };
  }
  return { cleared: s.claimAfter, died: false, gotUnique };
}

export interface DoomResult {
  runs: number;
  deaths: number;
  /** Levels the player fought, including the ones they died on. */
  levelsFought: number;
  levelsCleared: number;
  /** Loot actually claimed. `first` is the run number of the first claimed drop. */
  claimed: LootLine[];
  /** Loot forfeited by dying. */
  lost: Array<{ name: string; qty: number; drops: number }>;
}

export function simulateDoom(s: DoomStrategy, runs: number, rng: Rng = Math.random): DoomResult {
  const claimed = new Map<string, LootLine>();
  const lost = new Map<string, { name: string; qty: number; drops: number }>();
  const pile: Array<[string, number]> = [];
  const push: Emit = (name, qty) => {
    pile.push([name, qty]);
  };
  let deaths = 0;
  let levelsFought = 0;
  let levelsCleared = 0;
  for (let run = 1; run <= runs; run++) {
    pile.length = 0;
    const out = playRun(s, rng, push);
    levelsCleared += out.cleared;
    levelsFought += out.cleared + (out.died ? 1 : 0);
    if (out.died) deaths++;
    for (const [name, qty] of pile) {
      if (out.died) {
        const l = lost.get(name) ?? { name, qty: 0, drops: 0 };
        l.qty += qty;
        l.drops += 1;
        lost.set(name, l);
      } else {
        let l = claimed.get(name);
        if (!l) {
          l = { name, qty: 0, drops: 0, first: run };
          claimed.set(name, l);
        }
        l.qty += qty;
        l.drops += 1;
      }
    }
  }
  return { runs, deaths, levelsFought, levelsCleared, claimed: Array.from(claimed.values()), lost: Array.from(lost.values()) };
}

/** Claimed GP of many players each doing `runs` runs, sorted ascending (for a luck percentile). */
export function doomValueSamples(s: DoomStrategy, runs: number, players: number, price: (n: string) => number, rng: Rng = Math.random): number[] {
  const out: number[] = [];
  let pileValue = 0;
  const push: Emit = (name, qty) => {
    pileValue += qty * price(name);
  };
  for (let p = 0; p < players; p++) {
    let v = 0;
    for (let r = 0; r < runs; r++) {
      pileValue = 0;
      if (!playRun(s, rng, push).died) v += pileValue;
    }
    out.push(v);
  }
  return out.sort((a, b) => a - b);
}

/** Expected GP that clearing one level adds to the pile. */
export function levelValue(level: number, price: (n: string) => number): number {
  let v = 0;
  COMMON.forEach((e, i) => {
    v += (e.weight / COMMON_TOTAL) * meanCommonQty(i, level) * price(e.name);
  });
  for (const n of UNIQUE_NAMES) v += uniqueChance(n, level) * price(n);
  v += petChance(level) * price(PET);
  v += clueChance(level) * price(CLUE);
  v += guaranteedTears(level) * price(TEARS);
  return v;
}

export interface DepthRow {
  claimAfter: number;
  /** Chance of surviving every level up to the claim. */
  survive: number;
  /** Expected levels fought per run, counting the level you die on. */
  levelsPerRun: number;
  gpPerRun: number;
  gpPerLevel: number;
  /** Expected claimed uniques (cloth, eye, treads) per run. */
  uniquesPerRun: number;
  petPerRun: number;
}

/**
 * Exact expectations for always claiming after delve N (no stopping early on a unique),
 * for N = 1..maxDepth. Used to compare how deep it is worth going.
 */
export function depthTable(death: DeathChances, price: (n: string) => number, maxDepth = 12): DepthRow[] {
  const rows: DepthRow[] = [];
  let reach = 1; // chance of starting this level
  let levels = 0;
  let pileGp = 0;
  let pileUniques = 0;
  let pilePet = 0;
  for (let n = 1; n <= maxDepth; n++) {
    levels += reach;
    reach *= 1 - deathAt(death, n);
    pileGp += levelValue(n, price);
    pileUniques += anyUniqueChance(n);
    pilePet += petChance(n);
    const gpPerRun = reach * pileGp;
    rows.push({
      claimAfter: n,
      survive: reach,
      levelsPerRun: levels,
      gpPerRun,
      gpPerLevel: gpPerRun / levels,
      uniquesPerRun: reach * pileUniques,
      petPerRun: reach * pilePet,
    });
  }
  return rows;
}

/** Every item the module can produce, for price lookups. */
export const DOOM_ITEMS: string[] = [...COMMON.map((e) => e.name), ...UNIQUE_NAMES, PET, CLUE].filter((n, i, a) => a.indexOf(n) === i);

export const DEFAULT_DEATH: DeathChances = [0, 0, 0, 0, 0.01, 0.02, 0.03, 0.05, 0.08];

export const DOOM_NOTES = [
  'Each cleared delve adds one common roll, one unique roll, a pet roll, an elite clue roll (1/75 at delves 1–2, 1/50 after) and, from delve 3, 50 demon tears rising by 10 per delve to 100 at delve 8+.',
  'Unique and pet rates rise with depth and stop improving at delve 9. Common quantities are listed for delve 3 and scale from −50% at delve 1 to +20% at delve 9+.',
  'The wiki does not say how the three uniques share a level, so they are modelled as one roll (at most one unique per level), which matches the published "any unique" rates.',
  'The common roll is assumed to happen on every level, including levels that also give a unique.',
  'Dying to Doom forfeits everything in the pile for that run. Death chances are your own estimate; the defaults are only a starting point.',
];
