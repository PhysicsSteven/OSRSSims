// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseDropTables } from '../parsePage';
import { buildSource, itemRates, perUnitRate, uniqueItems } from '../model';
import { rollOnce, seededRng, simulate, type RunState } from '../sim';
import { chanceByNow, countProbabilities, luckPercentile, valueMoments } from '../stats';
import { LEVIATHAN_HTML, MONSTER_HTML } from './fixture';

const none = async () => null;
const leviathan = () => buildSource('The Leviathan', parseDropTables(LEVIATHAN_HTML), none);

describe('DT2 vestige counter', () => {
  it('turns the vestige row into a counter and drops the listed gold rings', async () => {
    const src = await leviathan();
    const names = src.main.outcomes.map((o) => o.label);
    expect(names).toContain('Venator vestige roll');
    expect(names).not.toContain('Gold ring');
    const roll = src.main.outcomes.find((o) => o.counter)!;
    expect(roll.p).toBeCloseTo(3 / 768);
    expect(src.notes.some((n) => n.includes('gold ring counter'))).toBe(true);
  });

  it('gives a ring, two rings, then the vestige, carrying over between kills', async () => {
    const src = await leviathan();
    // Force every main roll onto the vestige roll by making it the only outcome.
    const only = src.main.outcomes.find((o) => o.counter)!;
    const forced = { ...src, main: { ...src.main, outcomes: [only], cumulative: [1] } };
    const state: RunState = new Map();
    const seen: string[] = [];
    for (let k = 0; k < 6; k++) {
      const got: string[] = [];
      rollOnce(forced, seededRng(k), (n, q) => n !== 'Bones' && got.push(`${n}×${q}`), state);
      seen.push(got.join(','));
    }
    expect(seen).toEqual(['Gold ring×1', 'Gold ring×2', 'Venator vestige×1', 'Gold ring×1', 'Gold ring×2', 'Venator vestige×1']);
  });

  it('keeps the per-kill vestige rate and simulates close to it', async () => {
    const src = await leviathan();
    const rates = itemRates(src);
    const v = rates.get('Venator vestige')!;
    expect(perUnitRate(v)).toBeCloseTo(1 / 768);
    expect(v.every).toBe(3);
    expect(perUnitRate(rates.get('Gold ring')!)).toBeCloseTo((2 * 3) / 768 / 3);
    expect(rates.get('Gold ring')!.meanQty).toBeCloseTo(1.5);
    expect(uniqueItems(rates, 1 / 100).map((u) => u.name)).toContain('Venator vestige');
    const n = 300_000;
    const res = simulate(src, n, seededRng(9));
    const got = res.loot.get('Venator vestige')!.drops;
    expect(Math.abs(got - n / 768)).toBeLessThan(4 * Math.sqrt(n / 768));
    expect(res.loot.get('Gold ring')!.qty).toBeGreaterThanOrEqual(3 * got);
    const price = (name: string) => (name === 'Venator vestige' ? 768 : 0);
    expect(valueMoments(src, price).mean).toBeCloseTo(1, 3);
  });

  it('uses three-roll maths for luck', async () => {
    const rates = itemRates(await leviathan());
    const v = rates.get('Venator vestige')!;
    // Chance of a vestige by 768 kills = P(at least 3 vestige rolls at 3/768), about 0.58.
    const p = 3 / 768;
    const none = Math.pow(1 - p, 768);
    const one = 768 * p * Math.pow(1 - p, 767);
    const two = ((768 * 767) / 2) * p * p * Math.pow(1 - p, 766);
    expect(chanceByNow(v, 768)).toBeCloseTo(1 - none - one - two, 6);
    // You cannot have one after a single kill.
    expect(chanceByNow(v, 1)).toBe(0);
    const [below, at] = countProbabilities(v, 768, 1);
    expect(below).toBeCloseTo(none + one + two, 6);
    expect(at).toBeGreaterThan(0);
    expect(luckPercentile(v, 768, 2)).toBeGreaterThan(0.75);
  });

  it('leaves other monsters alone', async () => {
    const src = await buildSource('Zulrah', parseDropTables(MONSTER_HTML), none);
    expect(src.main.outcomes.some((o) => o.counter)).toBe(false);
    expect(itemRates(src).get('Tanzanite fang')!.every).toBeUndefined();
  });
});
