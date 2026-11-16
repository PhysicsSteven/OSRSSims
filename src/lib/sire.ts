// Abyssal Sire: optionally offer ("consume") every unsired at the Font of Consumption.
//
// The Sire's own drop table comes live from the wiki like any other monster. The unsired it
// drops is rolled here instead, because its reward table has two stateful rules the generic
// drop-table engine cannot express:
//  - Bludgeon pieces: "The player may not obtain any duplicate pieces until all three pieces
//    have been obtained per bludgeon", so each piece is drawn from those the player has fewest of.
//  - Abyssal orphan: once owned it is removed and the table rolls out of 123 instead of 128.
// Rates are from https://oldschool.runescape.wiki/w/Unsired (rolled at the Font since 2 September 2026).

import type { ItemRate } from './model';
import type { Emit, Rng } from './sim';

export const SIRE_TITLE = 'Abyssal Sire';
export const UNSIRED = 'Unsired';
export const ORPHAN = 'Abyssal orphan';
export const BLUDGEON_PIECES = ['Bludgeon claw', 'Bludgeon spine', 'Bludgeon axon'] as const;
const BLUDGEON = 'Bludgeon piece';

/** Font of Consumption rewards, weights out of 128. All quantities are 1. */
export const UNSIRED_TABLE: ReadonlyArray<{ name: string; weight: number }> = [
  { name: BLUDGEON, weight: 62 },
  { name: 'Abyssal dagger', weight: 26 },
  { name: 'Jar of miasma', weight: 13 },
  { name: 'Abyssal whip', weight: 12 },
  { name: 'Abyssal head', weight: 10 },
  { name: ORPHAN, weight: 5 },
];
export const UNSIRED_TOTAL = 128;

/** Every item an unsired can give, as it appears in the loot. */
export const UNSIRED_ITEMS = new Set<string>([...BLUDGEON_PIECES, ...UNSIRED_TABLE.map((r) => r.name).filter((n) => n !== BLUDGEON)]);

export function isSire(title: string | null | undefined): boolean {
  return !!title && title.trim().toLowerCase() === SIRE_TITLE.toLowerCase();
}

/** What one player has had from the Font so far. */
export interface FontState {
  pieces: [number, number, number];
  hasOrphan: boolean;
}

export const newFontState = (): FontState => ({ pieces: [0, 0, 0], hasOrphan: false });

/** Offers one unsired and returns the item received. */
export function offerUnsired(state: FontState, rng: Rng): string {
  const total = state.hasOrphan ? UNSIRED_TOTAL - 5 : UNSIRED_TOTAL;
  let r = rng() * total;
  let pick = UNSIRED_TABLE[0].name;
  for (const row of UNSIRED_TABLE) {
    if (row.name === ORPHAN && state.hasOrphan) continue;
    if (r < row.weight) {
      pick = row.name;
      break;
    }
    r -= row.weight;
  }
  if (pick === ORPHAN) state.hasOrphan = true;
  if (pick !== BLUDGEON) return pick;
  const fewest = Math.min(...state.pieces);
  const eligible = [0, 1, 2].filter((i) => state.pieces[i] === fewest);
  const i = eligible[Math.floor(rng() * eligible.length)];
  state.pieces[i] += 1;
  return BLUDGEON_PIECES[i];
}

/** Wraps a loot callback so each unsired is offered at the Font instead of kept. One wrapper per simulated player. */
export function consumingEmit(emit: Emit, rng: Rng): Emit {
  const state = newFontState();
  return (name, qty) => {
    if (name !== UNSIRED) return emit(name, qty);
    for (let i = 0; i < qty; i++) emit(offerUnsired(state, rng), 1);
  };
}

/**
 * Swaps the unsired's per-kill rate for the rates of what it turns into. These are the rates
 * before the orphan is owned (out of 128), which is what the pet and luck maths need; each
 * bludgeon piece gets a third of the bludgeon share, which is exact over the long run.
 */
export function consumeUnsiredRates(rates: Map<string, ItemRate>): void {
  const unsired = rates.get(UNSIRED);
  if (!unsired) return;
  rates.delete(UNSIRED);
  const add = (name: string, share: number, pet: boolean) => {
    let r = rates.get(name);
    if (!r) {
      r = { name, routes: [], meanQty: 1, pet, tertiary: false, direct: true };
      rates.set(name, r);
    }
    for (const route of unsired.routes) r.routes.push({ trials: route.trials, p: route.p * share });
  };
  for (const row of UNSIRED_TABLE) {
    const share = row.weight / UNSIRED_TOTAL;
    if (row.name === BLUDGEON) for (const piece of BLUDGEON_PIECES) add(piece, share / 3, false);
    else add(row.name, share, row.name === ORPHAN);
  }
}

/** Expected GP from offering one unsired (orphan not yet owned). Used for the expected-value maths. */
export function unsiredValue(price: (name: string) => number): number {
  let v = 0;
  for (const row of UNSIRED_TABLE) {
    const each = row.name === BLUDGEON ? BLUDGEON_PIECES.reduce((a, p) => a + price(p), 0) / 3 : price(row.name);
    v += (row.weight / UNSIRED_TOTAL) * each;
  }
  return v;
}
