// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseQuantity, parseRarity } from '../parseText';
import { parseDropTables, pickSubtable } from '../parsePage';
import { buildSource, itemRates, perUnitRate, uniqueItems } from '../model';
import { seededRng, simulate, unitsToComplete } from '../sim';
import { chanceByNow, luckPercentile, valueMoments } from '../stats';
import { MONSTER_HTML, RDT_HTML } from './fixture';

describe('parseRarity', () => {
  it('reads wiki formats', () => {
    expect(parseRarity('1/128')?.p).toBeCloseTo(1 / 128);
    expect(parseRarity('1/1,000[1]')?.p).toBeCloseTo(1 / 1000);
    expect(parseRarity('2.5/128')?.p).toBeCloseTo(2.5 / 128);
    expect(parseRarity('~1/50')).toMatchObject({ approximate: true });
    expect(parseRarity('2 × 1/128')).toMatchObject({ rolls: 2 });
    expect(parseRarity('Always')).toMatchObject({ p: 1, always: true });
    expect(parseRarity('Very rare')?.approximate).toBe(true);
    expect(parseRarity('')).toBeNull();
  });
});

describe('parseQuantity', () => {
  it('reads ranges, lists and noted', () => {
    expect(parseQuantity('100–299')).toEqual({ options: [[100, 299]], noted: false });
    expect(parseQuantity('1,000 (noted)')).toEqual({ options: [[1000, 1000]], noted: true });
    expect(parseQuantity('5; 10').options).toEqual([[5, 5], [10, 10]]);
    expect(parseQuantity('N/A').options).toEqual([[1, 1]]);
  });
});

const resolver = async (page: string, section?: string) =>
  page === 'Rare drop table' ? pickSubtable(parseDropTables(RDT_HTML), page, section) : null;

describe('page parsing and model', () => {
  it('classifies sections', () => {
    const tables = parseDropTables(MONSTER_HTML);
    const all = tables.flatMap((t) => t.entries);
    expect(all.find((e) => e.name === 'Bones')?.kind).toBe('always');
    expect(all.find((e) => e.name === 'Tanzanite fang')?.kind).toBe('main');
    expect(all.find((e) => e.name === 'Jar of swamp')?.kind).toBe('tertiary');
    expect(all.find((e) => e.name === 'Pet snakeling')?.kind).toBe('pet');
    expect(all.find((e) => e.name === 'Rare drop table')?.subtable?.page).toBe('Rare drop table');
    expect(all.find((e) => e.name === 'Coal')?.quantity.noted).toBe(true);
    expect(all.find((e) => e.name === 'Bones')?.image).toBe('https://oldschool.runescape.wiki/images/Bones.png?1a2b3');
  });

  it('resolves the rare drop table and its gem table', async () => {
    const src = await buildSource('Zulrah', parseDropTables(MONSTER_HTML), resolver);
    const rates = itemRates(src);
    expect(perUnitRate(rates.get('Loop half of key')!)).toBeCloseTo((4 / 128) * (20 / 128));
    expect(perUnitRate(rates.get('Uncut diamond')!)).toBeCloseTo((4 / 128) * (20 / 128) * (2 / 128));
    const uniques = uniqueItems(rates, 1 / 100).map((u) => u.name);
    expect(uniques).toContain('Pet snakeling');
    expect(uniques).toContain('Tanzanite fang');
    expect(uniques).not.toContain('Clue scroll (elite)');
    expect(uniques).not.toContain('Uncut diamond');
  });

  it('simulates close to the expected rates', async () => {
    const src = await buildSource('Zulrah', parseDropTables(MONSTER_HTML), resolver);
    const n = 200_000;
    const res = simulate(src, n, seededRng(42));
    expect(res.loot.get('Bones')!.drops).toBe(n);
    const coal = res.loot.get('Coal')!;
    expect(coal.drops / n).toBeCloseTo(20 / 128, 2);
    expect(coal.qty).toBe(coal.drops * 50);
    const scales = res.loot.get("Zulrah's scales")!;
    expect(scales.qty / n).toBeGreaterThan(195);
    expect(scales.qty / n).toBeLessThan(204);
    expect(res.loot.has('Nothing')).toBe(false);
  });

  it('computes completion and luck', async () => {
    const src = await buildSource('Zulrah', parseDropTables(MONSTER_HTML), resolver);
    const rates = itemRates(src);
    const kc = unitsToComplete(src, ['Tanzanite fang', 'Pet snakeling'], seededRng(1));
    expect(kc).toBeGreaterThan(0);
    const pet = rates.get('Pet snakeling')!;
    expect(chanceByNow(pet, 4000)).toBeCloseTo(1 - Math.pow(1 - 1 / 4000, 4000), 6);
    expect(luckPercentile(pet, 4000, 0)).toBeLessThan(0.25);
    expect(luckPercentile(pet, 100, 1)).toBeGreaterThan(0.95);
    const price = (n: string) => (n === 'Tanzanite fang' ? 1_000_000 : 0);
    expect(valueMoments(src, price).mean).toBeCloseTo(1_000_000 / 512, 3);
  });

  it('treats clue caskets as several rolls', async () => {
    const src = await buildSource('Reward casket (elite)', parseDropTables(MONSTER_HTML), resolver);
    expect(src.unit).toBe('casket');
    expect(src.mainRolls).toEqual({ min: 4, max: 6 });
  });
});

describe('the Mimic', () => {
  it('only rolls for elite and master caskets', async () => {
    const hard = await buildSource('Reward casket (hard)', parseDropTables(MONSTER_HTML), resolver);
    expect(hard.independent.some((i) => i.kind === 'mimic')).toBe(false);
    const elite = await buildSource('Reward casket (elite)', parseDropTables(MONSTER_HTML), resolver);
    expect(elite.independent.find((i) => i.kind === 'mimic')?.p).toBeCloseTo(1 / 35);
    const master = await buildSource('Reward casket (master)', parseDropTables(MONSTER_HTML), resolver);
    expect(master.independent.find((i) => i.kind === 'mimic')?.p).toBeCloseTo(1 / 15);
  });

  it('gives Mimic loot at the expected rates', async () => {
    const src = await buildSource('Reward casket (master)', parseDropTables(MONSTER_HTML), resolver);
    const mimic = src.independent.find((i) => i.kind === 'mimic')!;
    expect(mimic.outcome.sub!.cumulative.at(-1)).toBeCloseTo(1, 6);
    const rates = itemRates(src);
    expect(perUnitRate(rates.get('Ring of 3rd age')!)).toBeCloseTo((1 / 15) * (6 / 228));
    expect(perUnitRate(rates.get('Mahogany plank')!)).toBeCloseTo(1 / 15);
    expect(rates.get('Ring of 3rd age')!.mimic).toBe(true);
    expect(uniqueItems(rates, 1 / 100).map((u) => u.name)).toContain('Ring of 3rd age');

    const n = 300_000;
    const res = simulate(src, n, seededRng(7));
    expect(res.loot.get('Mahogany plank')!.drops / n).toBeCloseTo(1 / 15, 2);
    const death = res.loot.get('Death rune')!;
    expect(death.qty).toBe(death.drops * 600);

    const price = (name: string) => (name === 'Mahogany plank' ? 1000 : 0);
    expect(valueMoments(src, price).mean).toBeCloseTo(1000 / 15, 6);
  });
});
