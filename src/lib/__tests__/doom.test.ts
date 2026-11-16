import { describe, expect, it } from 'vitest';
import {
  anyUniqueChance,
  CLOTH,
  COMMON,
  COMMON_TOTAL,
  depthTable,
  EYE,
  guaranteedTears,
  levelValue,
  PET,
  petChance,
  playRun,
  rollLevel,
  scaleQty,
  simulateDoom,
  TEARS,
  TREADS,
  uniqueChance,
} from '../doom';
import { seededRng } from '../sim';

const NEVER = [0, 0, 0, 0, 0, 0, 0, 0, 0];

describe('Doom rates', () => {
  it('matches the published per-delve tables', () => {
    expect(uniqueChance(CLOTH, 1)).toBe(0);
    expect(uniqueChance(CLOTH, 2)).toBeCloseTo(1 / 2500);
    expect(uniqueChance(EYE, 2)).toBe(0);
    expect(uniqueChance(TREADS, 3)).toBe(0);
    expect(anyUniqueChance(4)).toBeCloseTo(1 / 450);
    expect(anyUniqueChance(8)).toBeCloseTo(1 / 210);
    expect(anyUniqueChance(9)).toBeCloseTo(1 / 180);
    expect(anyUniqueChance(30)).toBeCloseTo(1 / 180);
    expect(petChance(5)).toBe(0);
    expect(petChance(6)).toBeCloseTo(1 / 1000);
    expect(petChance(12)).toBeCloseTo(1 / 250);
    expect([1, 2, 3, 4, 8, 15].map(guaranteedTears)).toEqual([0, 0, 50, 60, 100, 100]);
  });

  it('has a common table that adds up to exactly one roll', () => {
    expect(COMMON.reduce((a, e) => a + e.weight, 0)).toBe(COMMON_TOTAL);
  });

  it('scales common quantities with depth', () => {
    expect(scaleQty(100, 1)).toBe(50);
    expect(scaleQty(100, 3)).toBe(100);
    expect(scaleQty(100, 9)).toBe(120);
    expect(scaleQty(1, 1)).toBe(1);
  });
});

describe('Doom simulation', () => {
  it('gives one common drop and the fixed tears per level', () => {
    const got: Array<[string, number]> = [];
    rollLevel(5, seededRng(3), (n, q) => got.push([n, q]));
    expect(got.filter(([n]) => COMMON.some((e) => e.name === n)).length).toBeGreaterThanOrEqual(1);
    expect(got.some(([n, q]) => n === TEARS && q === 70)).toBe(true);
  });

  it('loses the pile on death and keeps it otherwise', () => {
    const always = simulateDoom({ claimAfter: 3, stopOnUnique: false, death: [0, 0, 1, 0, 0, 0, 0, 0, 0] }, 50, seededRng(1));
    expect(always.deaths).toBe(50);
    expect(always.claimed).toEqual([]);
    expect(always.levelsCleared).toBe(100);
    expect(always.levelsFought).toBe(150);
    const safe = simulateDoom({ claimAfter: 3, stopOnUnique: false, death: NEVER }, 50, seededRng(1));
    expect(safe.deaths).toBe(0);
    expect(safe.lost).toEqual([]);
    expect(safe.claimed.find((l) => l.name === TEARS)!.qty).toBeGreaterThanOrEqual(50 * 50);
  });

  it('stops early on a unique when asked', () => {
    const rng = seededRng(7);
    for (let i = 0; i < 2000; i++) {
      const out = playRun({ claimAfter: 20, stopOnUnique: true, death: NEVER }, rng, () => {});
      if (out.gotUnique) {
        expect(out.cleared).toBeLessThanOrEqual(20);
        return;
      }
    }
    throw new Error('no unique in 2000 deep runs');
  });

  it('hits the unique rate over many runs', () => {
    const runs = 40_000;
    const res = simulateDoom({ claimAfter: 9, stopOnUnique: false, death: NEVER }, runs, seededRng(11));
    const uniques = [CLOTH, EYE, TREADS].reduce((a, n) => a + (res.claimed.find((l) => l.name === n)?.drops ?? 0), 0);
    const expected = runs * [1, 2, 3, 4, 5, 6, 7, 8, 9].reduce((a, l) => a + anyUniqueChance(l), 0);
    expect(Math.abs(uniques - expected)).toBeLessThan(4 * Math.sqrt(expected));
    const pets = res.claimed.find((l) => l.name === PET)?.drops ?? 0;
    const expectedPets = runs * [6, 7, 8, 9].reduce((a, l) => a + petChance(l), 0);
    expect(Math.abs(pets - expectedPets)).toBeLessThan(4 * Math.sqrt(expectedPets));
  });

  it('matches the depth table expectation', () => {
    const price = (n: string) => (n === TEARS ? 100 : n === CLOTH ? 50_000_000 : 1);
    const death = [0, 0, 0, 0, 0.05, 0.05, 0.1, 0.1, 0.1];
    const row = depthTable(death, price, 8)[7];
    expect(row.survive).toBeCloseTo(0.95 * 0.95 * 0.9 * 0.9, 10);
    const runs = 60_000;
    const res = simulateDoom({ claimAfter: 8, stopOnUnique: false, death }, runs, seededRng(5));
    const tearsGp = (res.claimed.find((l) => l.name === TEARS)?.qty ?? 0) * 100;
    const expectedTears = row.survive * [3, 4, 5, 6, 7, 8].reduce((a, l) => a + guaranteedTears(l), 0) * 100;
    expect(tearsGp / runs).toBeGreaterThan(expectedTears);
    expect(res.levelsFought / runs).toBeCloseTo(row.levelsPerRun, 1);
    expect(levelValue(9, price)).toBeGreaterThan(levelValue(3, price));
  });
});
