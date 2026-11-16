import { describe, expect, it } from 'vitest';
import { itemRates, makePool, perUnitRate, type DropSource } from '../model';
import { seededRng, simulate } from '../sim';
import { BLUDGEON_PIECES, newFontState, offerUnsired, ORPHAN, UNSIRED, UNSIRED_ITEMS, unsiredValue } from '../sire';

const leaf = (name: string) => ({ name, quantity: { options: [[1, 1]] as Array<[number, number]>, noted: false }, noted: false });

/** A cut-down Sire: an unsired 1 time in 4, otherwise coins. */
function sire(consume: boolean): DropSource {
  const notes: string[] = [];
  const main = makePool(
    'Main table',
    [
      { p: 0.25, leaf: leaf(UNSIRED), label: UNSIRED, rarityText: '1/4' },
      { p: 0.75, leaf: leaf('Coins'), label: 'Coins', rarityText: '3/4' },
    ],
    notes,
  );
  return { title: 'Abyssal Sire', unit: 'kill', always: [], main, mainRolls: { min: 1, max: 1 }, independent: [], notes, consumeUnsired: consume };
}

describe('unsired at the Font of Consumption', () => {
  it('never repeats a bludgeon piece until a full bludgeon is made', () => {
    const rng = seededRng(7);
    const state = newFontState();
    for (let i = 0; i < 5000; i++) {
      offerUnsired(state, rng);
      expect(Math.max(...state.pieces) - Math.min(...state.pieces)).toBeLessThanOrEqual(1);
    }
  });

  it('gives the orphan at most once', () => {
    const rng = seededRng(3);
    const state = newFontState();
    let orphans = 0;
    for (let i = 0; i < 20000; i++) if (offerUnsired(state, rng) === ORPHAN) orphans++;
    expect(orphans).toBe(1);
  });

  it('matches the wiki rates over many offers', () => {
    const rng = seededRng(11);
    const counts = new Map<string, number>();
    const n = 200_000;
    for (let i = 0; i < n; i++) {
      const name = offerUnsired(newFontState(), rng); // fresh player each time: rates out of 128
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    expect((counts.get('Abyssal dagger') ?? 0) / n).toBeCloseTo(26 / 128, 2);
    const pieces = BLUDGEON_PIECES.reduce((a, p) => a + (counts.get(p) ?? 0), 0);
    expect(pieces / n).toBeCloseTo(62 / 128, 2);
    expect((counts.get(ORPHAN) ?? 0) / n).toBeCloseTo(5 / 128, 2);
  });

  it('replaces unsired in the loot and in the rates only when consuming', () => {
    const kept = simulate(sire(false), 2000, seededRng(1));
    expect(kept.loot.has(UNSIRED)).toBe(true);

    const run = simulate(sire(true), 2000, seededRng(1));
    expect(run.loot.has(UNSIRED)).toBe(false);
    let offered = 0;
    for (const name of UNSIRED_ITEMS) offered += run.loot.get(name)?.drops ?? 0;
    // The Font draws extra random numbers, so compare against the expected 1 in 4 rather than the kept run.
    expect(offered).toBeGreaterThan(400);
    expect(offered).toBeLessThan(600);

    const rates = itemRates(sire(true));
    expect(rates.has(UNSIRED)).toBe(false);
    expect(perUnitRate(rates.get('Abyssal whip')!)).toBeCloseTo(0.25 * (12 / 128), 10);
    expect(perUnitRate(rates.get('Bludgeon claw')!)).toBeCloseTo((0.25 * (62 / 128)) / 3, 10);
    expect(rates.get(ORPHAN)!.pet).toBe(true);
  });

  it('values an unsired at the average Font reward', () => {
    const price = (n: string) => (n === 'Abyssal dagger' ? 128 : 0);
    expect(unsiredValue(price)).toBeCloseTo(26, 10);
  });
});
