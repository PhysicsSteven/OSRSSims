import { describe, expect, it } from 'vitest';
import { bossKeyFor, formatHours, parsePlayer, referenceRate } from '../killTime';

describe('bossKeyFor', () => {
  it('matches wiki titles to Wise Old Man boss keys', () => {
    expect(bossKeyFor('Vorkath')).toBe('vorkath');
    expect(bossKeyFor("Kree'arra")).toBe('kreearra');
    expect(bossKeyFor("K'ril Tsutsaroth")).toBe('kril_tsutsaroth');
    expect(bossKeyFor("Vet'ion")).toBe('vetion');
    expect(bossKeyFor('The Leviathan')).toBe('the_leviathan');
    expect(bossKeyFor('The Nightmare')).toBe('nightmare');
    expect(bossKeyFor("Phosani's Nightmare")).toBe('phosanis_nightmare');
    expect(bossKeyFor('TzKal-Zuk')).toBe('tzkal_zuk');
    expect(bossKeyFor('Chambers of Xeric')).toBe('chambers_of_xeric');
    expect(bossKeyFor('Chambers of Xeric/Challenge Mode')).toBe('chambers_of_xeric_challenge_mode');
    expect(bossKeyFor('Tombs of Amascut')).toBe('tombs_of_amascut');
    expect(bossKeyFor('Corrupted Gauntlet')).toBe('the_corrupted_gauntlet');
    expect(bossKeyFor('Doom of Mokhaiotl')).toBe('doom_of_mokhaiotl');
  });
  it('returns null for monsters with no rate', () => {
    expect(bossKeyFor('Abyssal demon')).toBeNull();
    expect(bossKeyFor('Reward casket (elite)')).toBeNull();
  });
});

describe('referenceRate', () => {
  it('reads the bundled table by account type', () => {
    expect(referenceRate('vorkath', 'main')).toBe(34);
    expect(referenceRate('corporeal_beast', 'ironman')).toBe(10);
    expect(referenceRate('zulrah', 'ultimate')).toBe(36);
  });
  it('falls back to the main rate when an account type has none', () => {
    expect(referenceRate('vorkath', 'def1')).toBe(34);
    expect(referenceRate(null, 'main')).toBeNull();
    expect(referenceRate('not_a_boss', 'main')).toBeNull();
  });
});

describe('parsePlayer', () => {
  it('maps account types and kill counts', () => {
    const p = parsePlayer({
      displayName: 'Some Iron',
      type: 'hardcore',
      build: 'main',
      combatLevel: 110,
      latestSnapshot: { data: { bosses: { vorkath: { kills: 512 }, zulrah: { kills: -1 } } } },
    });
    expect(p).toMatchObject({ name: 'Some Iron', accountType: 'ironman', typeLabel: 'hardcore ironman', combatLevel: 110 });
    expect(p.kills).toEqual({ vorkath: 512, zulrah: -1 });
    expect(parsePlayer({ type: 'regular', build: 'def1', latestSnapshot: null }).accountType).toBe('def1');
    expect(parsePlayer({ type: 'ultimate' }).accountType).toBe('ultimate');
  });
});

describe('formatHours', () => {
  it('formats short and long durations', () => {
    expect(formatHours(0.25)).toBe('15 min');
    expect(formatHours(2.345)).toBe('2.3 h');
    expect(formatHours(1234.4)).toBe('1,234 h');
  });
});
