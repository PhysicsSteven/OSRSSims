// Builds a simulation-ready drop source from parsed wiki tables.

import type { DropEntry, ParsedTable } from './parsePage';
import { meanQuantity, type Quantity } from './parseText';
import { mimicEncounter, mimicNote } from './mimic';

export interface Leaf {
  name: string;
  quantity: Quantity;
  noted: boolean;
  image?: string;
}

export interface Outcome {
  /** Probability of this outcome per roll of the pool it is in. */
  p: number;
  leaf?: Leaf;
  sub?: Pool;
  label: string;
  rarityText: string;
}

export interface Pool {
  name: string;
  outcomes: Outcome[];
  /** Cumulative probabilities for fast sampling; whatever is left above the last is "nothing". */
  cumulative: number[];
  /** Factor applied when the listed rates summed to more than 1. */
  scaledBy: number;
}

export interface Independent {
  p: number;
  rolls: number;
  outcome: Outcome;
  kind: 'tertiary' | 'pet' | 'mimic';
  /** Items given alongside the outcome every time the roll succeeds. */
  also?: Leaf[];
}

export type Rolls = { min: number; max: number };

export interface DropSource {
  title: string;
  unit: 'kill' | 'casket';
  always: Leaf[];
  main: Pool;
  mainRolls: Rolls;
  independent: Independent[];
  notes: string[];
}

export type SubtableResolver = (page: string, section?: string) => Promise<ParsedTable | null>;

/** Sections of a page that are not part of the normal drop (shown for reference only). */
const SKIP_HEADINGS = /mimic|gallery|history|trivia|changes|update|reward value|expected value/i;

const NOTHING = /^nothing$/i;

export function makePool(name: string, outcomes: Outcome[], notes: string[]): Pool {
  const total = outcomes.reduce((a, o) => a + o.p, 0);
  let scaledBy = 1;
  if (total > 1.0001) {
    scaledBy = 1 / total;
    notes.push(
      `${name}: listed rates add up to ${(total * 100).toFixed(1)}% per roll, so they were scaled down to 100%. ` +
        'This usually means the page lists several variants of the monster in one table.',
    );
  }
  const cumulative: number[] = [];
  let acc = 0;
  for (const o of outcomes) {
    acc += o.p * scaledBy;
    cumulative.push(acc);
  }
  return { name, outcomes, cumulative, scaledBy };
}

function leafOf(e: DropEntry): Leaf {
  return { name: e.name, quantity: e.quantity, noted: e.quantity.noted, image: e.image };
}

async function outcomeOf(
  e: DropEntry,
  resolve: SubtableResolver,
  notes: string[],
  depth: number,
  seen: Set<string>,
): Promise<Outcome> {
  const base = { p: e.rarity.p, label: e.name, rarityText: e.rarityText };
  if (!e.subtable || depth > 3) return { ...base, leaf: NOTHING.test(e.name) ? undefined : leafOf(e) };
  const key = `${e.subtable.page}#${e.subtable.section ?? ''}`.toLowerCase();
  if (seen.has(key)) return { ...base, leaf: leafOf(e) };
  let table: ParsedTable | null = null;
  try {
    table = await resolve(e.subtable.page, e.subtable.section);
  } catch {
    table = null;
  }
  if (!table) {
    notes.push(`Could not load "${e.name}"; it is counted as a single item instead.`);
    return { ...base, leaf: leafOf(e) };
  }
  const nextSeen = new Set(seen).add(key);
  const inner = await Promise.all(table.entries.map((x) => outcomeOf(x, resolve, notes, depth + 1, nextSeen)));
  return { ...base, sub: makePool(e.name, inner, notes) };
}

export const CLUE_ROLLS: Record<string, Rolls> = {
  beginner: { min: 1, max: 3 },
  easy: { min: 2, max: 4 },
  medium: { min: 3, max: 5 },
  hard: { min: 4, max: 6 },
  elite: { min: 4, max: 6 },
  master: { min: 5, max: 7 },
};

export function clueTier(title: string): string | null {
  const m = title.match(/^Reward casket \((\w+)\)$/i);
  return m && CLUE_ROLLS[m[1].toLowerCase()] ? m[1].toLowerCase() : null;
}

export async function buildSource(title: string, tables: ParsedTable[], resolve: SubtableResolver): Promise<DropSource> {
  const notes: string[] = [];
  const tier = clueTier(title);
  const always: Leaf[] = [];
  const mainEntries: DropEntry[] = [];
  const indepEntries: DropEntry[] = [];
  let skipped = 0;
  for (const t of tables) {
    if (t.headings.some((h) => SKIP_HEADINGS.test(h))) {
      skipped += t.entries.length;
      continue;
    }
    for (const e of t.entries) {
      if (e.kind === 'always' && !e.subtable) {
        if (!NOTHING.test(e.name)) always.push(leafOf(e));
      } else if (e.kind !== 'main') indepEntries.push(e);
      else mainEntries.push(e);
    }
  }
  if (skipped) notes.push(`${skipped} rows in sections like mimic rewards were left out of the simulation.`);

  const mainOutcomes = await Promise.all(mainEntries.map((e) => outcomeOf(e, resolve, notes, 0, new Set())));
  const main = makePool('Main table', mainOutcomes, notes);

  const independent: Independent[] = [];
  for (const e of indepEntries) {
    const outcome = await outcomeOf(e, resolve, notes, 0, new Set());
    independent.push({ p: e.rarity.p, rolls: e.rarity.rolls, outcome, kind: e.kind === 'pet' ? 'pet' : 'tertiary' });
  }

  const listedRolls = Math.max(1, ...mainEntries.map((e) => e.rarity.rolls));
  const mainRolls = tier ? CLUE_ROLLS[tier] : { min: listedRolls, max: listedRolls };
  if (tier) notes.push(`${tier[0].toUpperCase() + tier.slice(1)} caskets give ${mainRolls.min}–${mainRolls.max} reward rolls; tertiary rewards roll once per casket.`);
  if (tier === 'elite' || tier === 'master') {
    independent.push(mimicEncounter(tier, notes));
    notes.push(mimicNote(tier));
  }
  if (mainEntries.some((e) => e.rarity.approximate) || indepEntries.some((e) => e.rarity.approximate))
    notes.push('Some rates on the wiki are approximate (shown with ~ or as a word like "Rare"); the simulator uses a best estimate for them.');

  return { title, unit: tier ? 'casket' : 'kill', always, main, mainRolls, independent, notes };
}

/** Expected number of each item per kill or casket, used for value and luck maths. */
export interface ItemRate {
  name: string;
  /** Each route is (trials per unit, probability per trial). */
  routes: Array<{ trials: number; p: number }>;
  meanQty: number;
  pet: boolean;
  tertiary: boolean;
  /** True when the item can come from the Mimic. */
  mimic?: boolean;
  image?: string;
  /** True when the item can drop straight from this source, not only via a shared table like the RDT. */
  direct: boolean;
}

export function itemRates(src: DropSource): Map<string, ItemRate> {
  const rates = new Map<string, ItemRate>();
  let mimic = false;
  const add = (leaf: Leaf, trials: number, p: number, pet: boolean, tertiary: boolean, direct = true) => {
    if (p <= 0) return;
    let r = rates.get(leaf.name);
    if (!r) {
      r = { name: leaf.name, routes: [], meanQty: meanQuantity(leaf.quantity), pet, tertiary, direct };
      rates.set(leaf.name, r);
    }
    r.image ??= leaf.image;
    r.routes.push({ trials, p });
    r.pet ||= pet;
    r.direct ||= direct;
    if (mimic) r.mimic = true;
  };
  const walk = (pool: Pool, trials: number, scale: number, pet: boolean, tertiary: boolean, direct: boolean) => {
    for (const o of pool.outcomes) {
      const p = o.p * pool.scaledBy * scale;
      if (o.leaf) add(o.leaf, trials, p, pet, tertiary, direct);
      if (o.sub) walk(o.sub, trials, p, pet, tertiary, false);
    }
  };
  for (const leaf of src.always) add(leaf, 1, 1, false, false);
  const avgRolls = (src.mainRolls.min + src.mainRolls.max) / 2;
  walk(src.main, avgRolls, 1, false, false, true);
  for (const ind of src.independent) {
    const pet = ind.kind === 'pet';
    mimic = ind.kind === 'mimic';
    // The Mimic's own table counts as direct: its items (like the Ring of 3rd age) only come from here.
    if (ind.outcome.leaf) add(ind.outcome.leaf, ind.rolls, ind.p, pet, !pet && !mimic);
    if (ind.outcome.sub) walk(ind.outcome.sub, ind.rolls, ind.p, pet, !pet && !mimic, mimic);
    for (const leaf of ind.also ?? []) add(leaf, ind.rolls, ind.p, false, false, false);
    mimic = false;
  }
  return rates;
}

export function perUnitRate(r: ItemRate): number {
  return r.routes.reduce((a, x) => a + x.trials * x.p, 0);
}

const NOT_IN_LOG = /^(coins|clue scroll|scroll box|nothing|brimstone key|larran's key|ancient shard|dark totem)/i;

/**
 * Items we treat as collection log slots: pets plus anything rarer than the threshold that
 * drops straight from this source (shared tables like the rare drop table are left out).
 */
export function uniqueItems(rates: Map<string, ItemRate>, threshold: number): ItemRate[] {
  return Array.from(rates.values())
    .filter((r) => !NOT_IN_LOG.test(r.name) && (r.pet || (r.direct && perUnitRate(r) <= threshold)))
    .sort((a, b) => perUnitRate(b) - perUnitRate(a));
}
