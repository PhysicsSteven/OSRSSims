// Desert Treasure II bosses: the vestige is not an ordinary drop.
//
// Part of the unique table is a "vestige roll". The game keeps a hidden counter: the first
// vestige roll gives a gold ring, the second gives two gold rings, and the third gives the
// vestige and resets the counter. The count carries over between trips. (OSRS Wiki, The
// Leviathan; Jagex "Desert Treasure II tweaks and drop rates", August 2023.)
//
// The wiki lists the vestige at its effective per-kill rate, so here a vestige row of rate p
// becomes a vestige roll of rate 3p that walks through the counter.

import { makePool, type DropSource, type Leaf, type Outcome, type Pool } from './model';

export const VESTIGE = /^(ultor|bellator|magus|venator) vestige$/i;
const GOLD_RING = /^gold ring$/i;

/** Rolls per vestige: ring, two rings, vestige. */
export const VESTIGE_STEPS = 3;

const ring = (qty: number): Leaf => ({
  name: 'Gold ring',
  quantity: { options: [[qty, qty]], noted: false },
  noted: false,
});

function counterOutcome(o: Outcome): Outcome {
  const vestige = o.leaf!;
  return {
    p: o.p * VESTIGE_STEPS,
    label: `${vestige.name} roll`,
    rarityText: o.rarityText,
    counter: { key: vestige.name, steps: [[ring(1)], [ring(2)], [vestige]] },
  };
}

function rework(pool: Pool, notes: string[], found: string[]): Pool {
  let changed = false;
  const outcomes: Outcome[] = [];
  const hasVestige = pool.outcomes.some((o) => o.leaf && VESTIGE.test(o.leaf.name));
  for (const o of pool.outcomes) {
    if (o.leaf && VESTIGE.test(o.leaf.name)) {
      found.push(o.leaf.name);
      outcomes.push(counterOutcome(o));
      changed = true;
    } else if (hasVestige && o.leaf && GOLD_RING.test(o.leaf.name)) {
      // Gold rings on a vestige table come from the counter; listing them too would double count.
      changed = true;
    } else if (o.sub) {
      const sub = rework(o.sub, notes, found);
      if (sub !== o.sub) changed = true;
      outcomes.push(sub === o.sub ? o : { ...o, sub });
    } else outcomes.push(o);
  }
  return changed ? makePool(pool.name, outcomes, notes) : pool;
}

/** Rewrites vestige drops on a DT2 boss into the gold ring counter. Other sources are returned unchanged. */
export function applyVestigeCounter(src: DropSource): DropSource {
  const notes: string[] = [];
  const found: string[] = [];
  const main = rework(src.main, notes, found);
  const independent = src.independent.map((ind) => {
    const o = ind.outcome;
    if (o.leaf && VESTIGE.test(o.leaf.name)) {
      found.push(o.leaf.name);
      return { ...ind, p: Math.min(1, ind.p * VESTIGE_STEPS), outcome: { ...counterOutcome(o), p: 1 } };
    }
    if (o.sub) {
      const sub = rework(o.sub, notes, found);
      return sub === o.sub ? ind : { ...ind, outcome: { ...o, sub } };
    }
    return ind;
  });
  if (!found.length) return src;
  notes.unshift(
    `${found.join(', ')}: modelled with the Desert Treasure II gold ring counter. Each vestige roll (3× the listed vestige rate) gives a gold ring, then two gold rings, then the vestige, and the count carries over between kills.`,
  );
  return { ...src, main, independent, notes: [...src.notes, ...notes] };
}
