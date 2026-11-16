import { describe, expect, it } from 'vitest';
import * as cox from '../cox';
import * as toa from '../toa';
import { simulateRaids } from '../raid';
import { seededRng } from '../sim';

describe('Chambers of Xeric', () => {
  it('gives 1% per 8,676 points, capped at 570,000 per roll, up to six rolls', () => {
    expect(cox.rollChances(8_676)).toEqual([0.01]);
    expect(cox.rollChances(570_000)[0]).toBeCloseTo(0.657, 3);
    const big = cox.rollChances(855_000);
    expect(big).toHaveLength(2);
    expect(big[1]).toBeCloseTo(0.3285, 4);
    expect(cox.rollChances(10_000_000)).toHaveLength(6);
  });

  it('has unique tables that add up to 60 and 56', () => {
    expect(cox.UNIQUES_NORMAL.reduce((a, u) => a + u.weight, 0)).toBe(60);
    expect(cox.UNIQUES_CM.reduce((a, u) => a + u.weight, 0)).toBe(56);
    expect(cox.COMMON).toHaveLength(33);
  });

  it('scales common quantities with points up to 131,071', () => {
    const death = cox.COMMON.find((c) => c.name === 'Death rune')!;
    expect(cox.commonQty(death, 131_071)).toBe(3640);
    expect(cox.commonQty(death, 500_000)).toBe(3640);
    expect(cox.commonQty(death, 36_000)).toBe(999);
    expect(cox.commonQty(death, 0)).toBe(1);
  });

  it('splits the unique by points in a team', () => {
    const solo = cox.coxChances({ size: 1, you: 30_000, total: 30_000 });
    expect(solo.you).toBeCloseTo(30_000 / 867_600, 10);
    const trio = cox.coxChances({ size: 3, you: 30_000, total: 90_000 });
    expect(trio.anyUnique).toBeCloseTo(90_000 / 867_600, 10);
    expect(trio.you).toBeCloseTo(trio.anyUnique / 3, 10);
    // Two rolls, two players: whoever misses the first can still get the second.
    const duo = cox.coxChances({ size: 2, you: 570_000, total: 1_140_000 });
    const p = 570_000 / 867_600;
    // Win roll 1; or the other player wins roll 1 and you get roll 2; or roll 1 misses and you win roll 2.
    expect(duo.you).toBeCloseTo(p / 2 + (p / 2) * p + ((1 - p) * p) / 2, 10);
  });

  it('matches the exact chances in simulation', () => {
    const s = { size: 4, you: 40_000, total: 700_000, challengeMode: false, cmInTime: false };
    const runs = 40_000;
    const res = simulateRaids(() => cox.makeCoxRoller(s), runs, seededRng(3));
    const ch = cox.coxChances(s);
    expect(Math.abs(res.yourUniques - runs * ch.you)).toBeLessThan(4 * Math.sqrt(runs * ch.you));
    expect(Math.abs(res.teamUniques - runs * ch.teamUniques)).toBeLessThan(4 * Math.sqrt(runs * ch.teamUniques));
    // No common loot on raids with a unique: two common drops on every other raid.
    const commons = res.loot.filter((l) => cox.COMMON.some((c) => c.name === l.name)).reduce((a, l) => a + l.drops, 0);
    expect(commons).toBe(2 * (runs - res.purpleRaids));
  });
});

describe('Tombs of Amascut', () => {
  it('scales the raid level like the wiki', () => {
    expect(toa.uniqueLevel(300)).toBe(300);
    expect(toa.uniqueLevel(400)).toBe(340);
    expect(toa.uniqueLevel(430)).toBe(350);
    expect(toa.uniqueLevel(490)).toBe(360);
    expect(toa.petLevel(550)).toBe(450);
    expect(toa.petLevel(600)).toBe(450);
  });

  it('gives 1% per 10,500 − 20×RL points, capped at 55%', () => {
    expect(toa.uniqueChance(3_700, 400)).toBeCloseTo(0.01, 10);
    expect(toa.uniqueChance(4_500 * 10, 300)).toBeCloseTo(0.1, 10);
    expect(toa.uniqueChance(1_000_000, 500)).toBe(0.55);
  });

  it('matches the wiki unique weights at listed levels', () => {
    const at = (level: number) => {
      const t = toa.uniqueTable(level);
      const w = t.reduce((a, e) => a + e.weight, 0);
      return Object.fromEntries(t.map((e) => [e.name, w / e.weight]));
    };
    expect(at(300)[toa.FANG]).toBeCloseTo(3.43, 2);
    expect(at(300)[toa.SHADOW]).toBe(24);
    expect(at(400)[toa.FANG]).toBeCloseTo(4.75, 2);
    expect(at(400)[toa.LIGHTBEARER]).toBeCloseTo(3.8, 2);
    expect(at(500)[toa.SHADOW]).toBe(16.5);
    expect(at(500)[toa.LIGHTBEARER]).toBeCloseTo(4.71, 2);
  });

  it('computes common quantities with the raid level bonus and cap', () => {
    const death = toa.COMMON.find((c) => c.name === 'Death rune')!;
    expect(toa.commonQty(death, 20_000, 200)).toBe(1000);
    expect(toa.commonQty(death, 20_000, 300)).toBe(1150);
    expect(toa.commonQty(death, 20_000, 400)).toBe(1350);
    expect(toa.commonQty(death, 59_000, 600)).toBe(2564);
    expect(toa.COMMON).toHaveLength(27);
  });

  it('downgrades most uniques below raid level 150', () => {
    expect(toa.keepChance(300)).toBeCloseTo(1, 12);
    expect(toa.keepChance(100)).toBeCloseTo((14 + 10 / 50) / 24, 10);
    expect(toa.keepChance(0)).toBeCloseTo(1 / 50, 10);
  });

  it('matches the exact chances in simulation', () => {
    const s = { size: 3, you: 20_000, total: 60_000, level: 400 };
    const runs = 40_000;
    const res = simulateRaids(() => toa.makeToaRoller(s), runs, seededRng(9));
    const ch = toa.toaChances(s);
    expect(Math.abs(res.yourUniques - runs * ch.you)).toBeLessThan(4 * Math.sqrt(runs * ch.you));
    const commons = res.loot.filter((l) => toa.COMMON.some((c) => c.name === l.name)).reduce((a, l) => a + l.drops, 0);
    expect(commons).toBe(3 * (runs - res.purpleRaids));
    expect(res.loot.find((l) => l.name === toa.THREAD)!.drops).toBeGreaterThan(1);
  });

  it('caps points at 64,000 per player', () => {
    expect(toa.toaTeam({ size: 1, you: 100_000, total: 100_000 }).you).toBe(59_000);
    expect(toa.toaTeam({ size: 2, you: 10_000, total: 500_000 }).total).toBe(69_000);
  });
});
