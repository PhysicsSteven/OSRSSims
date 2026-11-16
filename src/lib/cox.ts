// Chambers of Xeric: loot is driven by points.
//
// Every 8,676 team points is a 1% chance of a unique, up to 570,000 points (65.7%) per
// roll. Points past that go into another roll, up to six uniques per raid. Who gets a
// unique is weighted by personal points. Everyone without a unique makes two rolls on
// the common table (never the same item twice), with quantities that grow with personal
// points up to 131,071.
//
// The wiki page "Ancient chest" (checked 2026-11-16) lists this as text and tables
// rather than an item-drops table, so it is kept here by hand. The unique weights are
// the ones from the 12 August 2026 update (normal 60, challenge mode 56).

import type { Emit, Rng } from './sim';
import { pickRecipient, pickWeighted, teamShape, type RaidRoller, type RaidTeam } from './raid';

export const COX_TITLE = 'Chambers of Xeric';
export const COX_ALIASES = /^(cox|chambers( of xeric)?|raids ?1|chambers of xeric: challenge mode|cox cm)$/i;

export const POINTS_PER_PERCENT = 8_676;
export const POINTS_PER_ROLL = 570_000;
export const MAX_UNIQUES = 6;
/** Common quantities stop growing at this many personal points. */
export const COMMON_POINT_CAP = 131_071;

export interface UniqueEntry {
  name: string;
  weight: number;
}

export const UNIQUES_NORMAL: readonly UniqueEntry[] = [
  { name: 'Dexterous prayer scroll', weight: 14 },
  { name: 'Arcane prayer scroll', weight: 14 },
  { name: 'Twisted buckler', weight: 4 },
  { name: 'Dragon hunter crossbow', weight: 4 },
  { name: "Dinh's bulwark", weight: 3 },
  { name: 'Ancestral hat', weight: 4 },
  { name: 'Ancestral robe top', weight: 4 },
  { name: 'Ancestral robe bottom', weight: 4 },
  { name: 'Dragon claws', weight: 3 },
  { name: 'Elder maul', weight: 2 },
  { name: 'Kodai insignia', weight: 2 },
  { name: 'Twisted bow', weight: 2 },
];

/** Challenge mode: the prayer scrolls drop to 12, everything else is unchanged. */
export const UNIQUES_CM: readonly UniqueEntry[] = UNIQUES_NORMAL.map((u) => (u.name.endsWith('prayer scroll') ? { ...u, weight: 12 } : u));

export const OLMLET = 'Olmlet';
export const OLMLET_PER_UNIQUE = 1 / 53;
export const CLUE = 'Clue scroll (elite)';
export const CLUE_CHANCE = 1 / 12;
export const DUST = 'Metamorphic dust';
export const DUST_CHANCE = 1 / 400;
export const KIT = 'Twisted ancestral colour kit';
export const KIT_CHANCE = 1 / 75;

export interface CommonEntry {
  name: string;
  /** Quantity at 131,071 points or more. Quantity scales linearly with points below that. */
  max: number;
  noted?: boolean;
}

/** The 33 common items, each equally likely. Maximums are the wiki's listed quantity ranges. */
export const COMMON: readonly CommonEntry[] = [
  { name: 'Death rune', max: 3640 },
  { name: 'Blood rune', max: 4095 },
  { name: 'Soul rune', max: 6553 },
  { name: 'Rune arrow', max: 9362 },
  { name: 'Dragon arrow', max: 648 },
  { name: 'Grimy ranarr weed', max: 138, noted: true },
  { name: 'Grimy toadflax', max: 210, noted: true },
  { name: 'Grimy irit leaf', max: 675, noted: true },
  { name: 'Grimy avantoe', max: 337, noted: true },
  { name: 'Grimy kwuarm', max: 289, noted: true },
  { name: 'Grimy snapdragon', max: 84, noted: true },
  { name: 'Grimy cadantine', max: 330, noted: true },
  { name: 'Grimy lantadyme', max: 442, noted: true },
  { name: 'Grimy dwarf weed', max: 546, noted: true },
  { name: 'Grimy torstol', max: 134, noted: true },
  { name: 'Silver ore', max: 6553, noted: true },
  { name: 'Coal', max: 6553, noted: true },
  { name: 'Gold ore', max: 2978, noted: true },
  { name: 'Mithril ore', max: 4095, noted: true },
  { name: 'Adamantite ore', max: 789, noted: true },
  { name: 'Runite ore', max: 65, noted: true },
  { name: 'Uncut sapphire', max: 697, noted: true },
  { name: 'Uncut emerald', max: 923, noted: true },
  { name: 'Uncut ruby', max: 541, noted: true },
  { name: 'Uncut diamond', max: 258, noted: true },
  { name: 'Lizardman fang', max: 4681 },
  { name: 'Pure essence', max: 65535, noted: true },
  { name: 'Saltpetre', max: 4681, noted: true },
  { name: 'Teak plank', max: 1365, noted: true },
  { name: 'Mahogany plank', max: 550, noted: true },
  { name: 'Dynamite', max: 2427, noted: true },
  { name: 'Torn prayer scroll', max: 1 },
  { name: 'Dark relic', max: 1 },
];

export function commonQty(e: CommonEntry, points: number): number {
  if (e.max === 1) return 1;
  const p = Math.max(0, Math.min(points, COMMON_POINT_CAP));
  return Math.max(1, Math.floor((e.max * p) / COMMON_POINT_CAP));
}

export interface CoxSettings extends RaidTeam {
  challengeMode: boolean;
  /** Challenge mode finished inside the time limit, so dust and the kit can drop. */
  cmInTime: boolean;
}

/** Chance of each unique roll succeeding, in order (at most six). */
export function rollChances(totalPoints: number): number[] {
  const out: number[] = [];
  let left = Math.max(0, totalPoints);
  while (left > 0 && out.length < MAX_UNIQUES) {
    out.push(Math.min(left, POINTS_PER_ROLL) / (POINTS_PER_PERCENT * 100));
    left -= POINTS_PER_ROLL;
  }
  return out;
}

export const uniqueTable = (s: { challengeMode: boolean }) => (s.challengeMode ? UNIQUES_CM : UNIQUES_NORMAL);

/**
 * Exact chances for one raid. Assumes a player can only receive one unique per raid,
 * so later rolls go to someone who has not had one yet.
 */
export function coxChances(s: RaidTeam): { teamUniques: number; you: number; anyUnique: number } {
  const t = teamShape(s);
  const others = t.size - 1;
  // State: [youGot][othersGot] -> probability.
  let state = new Map<string, number>([['0,0', 1]]);
  let teamUniques = 0;
  for (const p of rollChances(t.total)) {
    const next = new Map<string, number>();
    const add = (k: string, v: number) => next.set(k, (next.get(k) ?? 0) + v);
    for (const [k, prob] of state) {
      const [y, j] = k.split(',').map(Number);
      const wYou = y ? 0 : t.you;
      const wOthers = (others - j) * t.other;
      const w = wYou + wOthers;
      if (w <= 0) {
        add(k, prob);
        continue;
      }
      teamUniques += prob * p;
      add(k, prob * (1 - p));
      if (wYou) add(`1,${j}`, (prob * p * wYou) / w);
      if (wOthers) add(`${y},${j + 1}`, (prob * p * wOthers) / w);
    }
    state = next;
  }
  let you = 0;
  for (const [k, prob] of state) if (k.startsWith('1,')) you += prob;
  const anyUnique = 1 - rollChances(t.total).reduce((a, p) => a * (1 - p), 1);
  return { teamUniques, you, anyUnique };
}

export function makeCoxRoller(s: CoxSettings): RaidRoller {
  const t = teamShape(s);
  const table = uniqueTable(s);
  const chances = rollChances(t.total);
  const weights = [t.you, ...Array.from({ length: t.size - 1 }, () => t.other)];
  const live = new Array<number>(weights.length);
  const picks = new Array<number>(2);
  return (rng: Rng, emit: Emit) => {
    for (let i = 0; i < weights.length; i++) live[i] = weights[i];
    let teamUniques = 0;
    let yourUniques = 0;
    for (const p of chances) {
      if (rng() >= p) continue;
      const who = pickRecipient(rng, live);
      if (who < 0) break;
      live[who] = 0;
      teamUniques++;
      if (who === 0) {
        yourUniques++;
        emit(pickWeighted(rng, table).name, 1);
        if (rng() < OLMLET_PER_UNIQUE) emit(OLMLET, 1);
      }
    }
    if (!yourUniques) {
      // Two different common items.
      picks[0] = Math.floor(rng() * COMMON.length);
      picks[1] = Math.floor(rng() * (COMMON.length - 1));
      if (picks[1] >= picks[0]) picks[1]++;
      for (const i of picks) emit(COMMON[i].name, commonQty(COMMON[i], t.you));
      if (rng() < CLUE_CHANCE) emit(CLUE, 1);
    }
    if (s.challengeMode && s.cmInTime) {
      if (rng() < DUST_CHANCE) emit(DUST, 1);
      if (rng() < KIT_CHANCE) emit(KIT, 1);
    }
    return { teamUniques, yourUniques };
  };
}

/** Expected GP for you per raid. */
export function coxValuePerRaid(s: CoxSettings, price: (n: string) => number): { unique: number; common: number; other: number; total: number } {
  const t = teamShape(s);
  const { you } = coxChances(s);
  const table = uniqueTable(s);
  const w = table.reduce((a, e) => a + e.weight, 0);
  const uniqueAvg = table.reduce((a, e) => a + (e.weight / w) * price(e.name), 0) + OLMLET_PER_UNIQUE * price(OLMLET);
  const commonAvg = (2 / COMMON.length) * COMMON.reduce((a, e) => a + commonQty(e, t.you) * price(e.name), 0);
  const unique = you * uniqueAvg;
  const common = (1 - you) * (commonAvg + CLUE_CHANCE * price(CLUE));
  const other = s.challengeMode && s.cmInTime ? DUST_CHANCE * price(DUST) + KIT_CHANCE * price(KIT) : 0;
  return { unique, common, other, total: unique + common + other };
}

export const COX_ITEMS: string[] = [...UNIQUES_NORMAL.map((u) => u.name), OLMLET, CLUE, DUST, KIT, ...COMMON.map((c) => c.name)];
export const COX_UNIQUE_NAMES: string[] = [...UNIQUES_NORMAL.map((u) => u.name), OLMLET, DUST, KIT];

export const COX_NOTES = [
  'Every 8,676 team points is a 1% unique chance, up to 570,000 points (65.7%) per roll. Points past 570,000 roll again, up to six uniques per raid.',
  'Who gets a unique is weighted by personal points. Assumption: a player can only get one unique per raid, so later rolls skip anyone who already has one. The wiki does not say this outright.',
  'Other players are assumed to split the rest of the team points evenly. This only matters for who gets the second and later uniques.',
  'Without a unique you get two different items from the 33-item common table, plus a 1/12 elite clue roll (1/11 with the elite combat achievement tier is not modelled). With a unique you get no common loot, and each unique rolls the Olmlet at 1/53.',
  'Common quantities scale linearly with your personal points up to 131,071, where they hit the wiki\'s listed maximums. The wiki gives ranges rather than divisors, so quantities can be off by one from the game.',
  "Not modelled: herbs sometimes coming as seeds (a 33% chance per the wiki, at 7–8 herbs per seed), the dark journal and the one-off ancient tablet.",
  'Challenge mode uses the 56-weight table (prayer scrolls at 12). Metamorphic dust (1/400) and the twisted ancestral colour kit (1/75) only drop when the raid is finished inside the time limit; they are modelled as a roll per player.',
];
