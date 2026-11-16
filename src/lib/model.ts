// Builds a simulation-ready drop source from parsed wiki tables.

import type { DropEntry, ParsedTable } from './parsePage';
import { applyVestigeCounter } from './dt2';
import { meanQuantity, type Quantity } from './parseText';
import { consumeUnsiredRates } from './sire';

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
  /**
   * A roll that walks through a fixed sequence instead of dropping one item: the n-th hit
   * gives steps[n % steps.length]. The position carries over between kills (see dt2.ts).
   */
  counter?: { key: string; steps: Leaf[][] };
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
  kind: 'tertiary' | 'pet';
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
  /** Abyssal Sire only: offer each unsired at the Font of Consumption instead of keeping it. */
  consumeUnsired?: boolean;
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
  if (mainEntries.some((e) => e.rarity.approximate) || indepEntries.some((e) => e.rarity.approximate))
    notes.push('Some rates on the wiki are approximate (shown with ~ or as a word like "Rare"); the simulator uses a best estimate for them.');

  return applyVestigeCounter({ title, unit: tier ? 'casket' : 'kill', always, main, mainRolls, independent, notes });
}

/** Expected number of each item per kill or casket, used for value and luck maths. */
export interface ItemRate {
  name: string;
  /** Each route is (trials per unit, probability per trial). */
  routes: Array<{ trials: number; p: number }>;
  meanQty: number;
  pet: boolean;
  tertiary: boolean;
  image?: string;
  /** True when the item can drop straight from this source, not only via a shared table like the RDT. */
  direct: boolean;
  /** Set when the item only comes on every n-th success of its routes (DT2 vestiges). */
  every?: number;
}

export function itemRates(src: DropSource): Map<string, ItemRate> {
  const rates = new Map<string, ItemRate>();
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
  };
  const addCounter = (c: NonNullable<Outcome['counter']>, trials: number, p: number, pet: boolean, tertiary: boolean, direct: boolean) => {
    // Group each item's steps: an item on every step of the cycle is an ordinary drop at rate p;
    // otherwise it comes on some of the hits, and a single-step item gets the exact "every n-th" maths.
    const n = c.steps.length;
    const byName = new Map<string, Leaf[]>();
    for (const step of c.steps) for (const leaf of step) byName.set(leaf.name, [...(byName.get(leaf.name) ?? []), leaf]);
    for (const [name, leaves] of byName) {
      if (leaves.length === 1) {
        add(leaves[0], trials, p, pet, tertiary, direct);
        const r = rates.get(name)!;
        if (r.routes.length === 1) r.every = n;
        else r.routes[r.routes.length - 1].p = p / n;
      } else {
        const merged: Leaf = { ...leaves[0], quantity: { options: leaves.flatMap((l) => l.quantity.options), noted: leaves[0].noted } };
        add(merged, trials, (p * leaves.length) / n, pet, tertiary, direct);
      }
    }
  };
  const walk = (pool: Pool, trials: number, scale: number, pet: boolean, tertiary: boolean, direct: boolean) => {
    for (const o of pool.outcomes) {
      const p = o.p * pool.scaledBy * scale;
      if (o.leaf) add(o.leaf, trials, p, pet, tertiary, direct);
      if (o.sub) walk(o.sub, trials, p, pet, tertiary, false);
      if (o.counter) addCounter(o.counter, trials, p, pet, tertiary, direct);
    }
  };
  for (const leaf of src.always) add(leaf, 1, 1, false, false);
  const avgRolls = (src.mainRolls.min + src.mainRolls.max) / 2;
  walk(src.main, avgRolls, 1, false, false, true);
  for (const ind of src.independent) {
    const pet = ind.kind === 'pet';
    if (ind.outcome.leaf) add(ind.outcome.leaf, ind.rolls, ind.p, pet, !pet);
    if (ind.outcome.sub) walk(ind.outcome.sub, ind.rolls, ind.p, pet, !pet, false);
    if (ind.outcome.counter) addCounter(ind.outcome.counter, ind.rolls, ind.p, pet, !pet, true);
  }
  if (src.consumeUnsired) consumeUnsiredRates(rates);
  return rates;
}

export function perUnitRate(r: ItemRate): number {
  return r.routes.reduce((a, x) => a + x.trials * x.p, 0) / (r.every ?? 1);
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
