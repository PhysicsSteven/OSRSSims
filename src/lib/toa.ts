// Tombs of Amascut: loot is driven by points and raid level (set by the invocations).
//
// The team gets a 1% unique chance for every 10,500 − 20×RL points (RL is the raid level,
// scaled down above 310), capped at 55%. Only one unique per raid, given to a player
// weighted by points. Everyone else makes three rolls on the common table, with
// quantities of points ÷ divisor and a bonus from raid level 300.
//
// Source: OSRS Wiki "Chest (Tombs of Amascut)" (checked 2026-11-16). Kept by hand because
// the formulas and level-dependent weights are not an item-drops table.

import type { Emit, Rng } from './sim';
import { pickRecipient, pickWeighted, teamShape, type RaidRoller, type RaidTeam } from './raid';

export const TOA_TITLE = 'Tombs of Amascut';
export const TOA_ALIASES = /^(toa|tombs( of amascut)?|raids ?3)$/i;

/** Reward points are capped at 64,000 per player, and the starting 5,000 do not count for loot. */
export const START_POINTS = 5_000;
export const MAX_EARNED = 64_000 - START_POINTS;
export const MAX_UNIQUE_CHANCE = 0.55;

/** Raid level as used by the unique formula: full value to 310, a third to 430, a sixth after. */
export function uniqueLevel(level: number): number {
  const l = Math.max(0, level);
  if (l <= 310) return l;
  if (l <= 430) return 310 + (l - 310) / 3;
  return 350 + (l - 430) / 6;
}

/** Raid level as used by the pet formula: full value to 400, a third to 550, flat after. */
export function petLevel(level: number): number {
  const l = Math.max(0, level);
  if (l <= 400) return l;
  if (l <= 550) return 400 + (l - 400) / 3;
  return 450;
}

export function uniqueChance(totalPoints: number, level: number): number {
  return Math.min(MAX_UNIQUE_CHANCE, Math.max(0, totalPoints) / (100 * (10_500 - 20 * uniqueLevel(level))));
}

export function petChance(totalPoints: number, level: number): number {
  return Math.min(1, Math.max(0, totalPoints) / (100 * (350_000 - 700 * petLevel(level))));
}

export const FANG = "Osmumten's fang";
export const LIGHTBEARER = 'Lightbearer';
export const WARD = "Elidinis' ward";
export const MASK = 'Masori mask';
export const BODY = 'Masori body';
export const CHAPS = 'Masori chaps';
export const SHADOW = "Tumeken's shadow (uncharged)";
export const PET = "Tumeken's guardian";
export const CLUE = 'Clue scroll (elite)';
export const THREAD = 'Thread of elidinis';
export const JEWELS = ['Breach of the scarab', 'Eye of the corruptor', 'Jewel of the sun', 'Jewel of amascut'];

/**
 * Unique weights at the raid levels the wiki lists. Fang and Lightbearer get rarer above
 * 300, which makes the rest relatively more common. Levels in between are interpolated.
 */
const WEIGHT_LEVELS = [300, 350, 400, 450, 500];
const FANG_W = [7, 6, 4, 4, 3];
const LIGHTBEARER_W = [7, 6, 5, 4, 3.5];

function interp(ys: readonly number[], level: number): number {
  if (level <= WEIGHT_LEVELS[0]) return ys[0];
  for (let i = 1; i < WEIGHT_LEVELS.length; i++) {
    if (level <= WEIGHT_LEVELS[i]) {
      const f = (level - WEIGHT_LEVELS[i - 1]) / (WEIGHT_LEVELS[i] - WEIGHT_LEVELS[i - 1]);
      return ys[i - 1] + f * (ys[i] - ys[i - 1]);
    }
  }
  return ys[ys.length - 1];
}

export interface ToaUnique {
  name: string;
  weight: number;
  /** Below this raid level, rolling the item needs an extra 1/50 roll to keep it. */
  minLevel: number;
}

export function uniqueTable(level: number): ToaUnique[] {
  return [
    { name: FANG, weight: interp(FANG_W, level), minLevel: 50 },
    { name: LIGHTBEARER, weight: interp(LIGHTBEARER_W, level), minLevel: 50 },
    { name: WARD, weight: 3, minLevel: 150 },
    { name: MASK, weight: 2, minLevel: 150 },
    { name: BODY, weight: 2, minLevel: 150 },
    { name: CHAPS, weight: 2, minLevel: 150 },
    { name: SHADOW, weight: 1, minLevel: 150 },
  ];
}

export const LOW_LEVEL_KEEP = 1 / 50;

export interface ToaCommon {
  name: string;
  /** Points per item; 0 means always one. */
  divisor: number;
  noted?: boolean;
}

/** The 27 common items, each equally likely on each of the three rolls. */
export const COMMON: readonly ToaCommon[] = [
  { name: 'Coins', divisor: 1 },
  { name: 'Death rune', divisor: 20 },
  { name: 'Soul rune', divisor: 40 },
  { name: 'Gold ore', divisor: 90, noted: true },
  { name: 'Dragon dart tip', divisor: 100 },
  { name: 'Mahogany logs', divisor: 180, noted: true },
  { name: 'Sapphire', divisor: 200, noted: true },
  { name: 'Emerald', divisor: 250, noted: true },
  { name: 'Gold bar', divisor: 250, noted: true },
  { name: 'Potato cactus', divisor: 250, noted: true },
  { name: 'Raw shark', divisor: 250, noted: true },
  { name: 'Ruby', divisor: 300, noted: true },
  { name: 'Diamond', divisor: 400, noted: true },
  { name: 'Raw manta ray', divisor: 450, noted: true },
  { name: 'Cactus spine', divisor: 600, noted: true },
  { name: 'Dragonstone', divisor: 600, noted: true },
  { name: 'Battlestaff', divisor: 1100, noted: true },
  { name: 'Coconut milk', divisor: 1100, noted: true },
  { name: 'Lily of the sands', divisor: 1100, noted: true },
  { name: 'Toadflax seed', divisor: 2000 },
  { name: 'Ranarr seed', divisor: 2500 },
  { name: 'Torstol seed', divisor: 3200 },
  { name: 'Snapdragon seed', divisor: 3200 },
  { name: 'Dragon med helm', divisor: 4000, noted: true },
  { name: 'Magic seed', divisor: 6500 },
  { name: 'Blood essence', divisor: 7500 },
  { name: 'Cache of runes', divisor: 0 },
];

/**
 * The wiki's quantity ranges top out at 51,285 coins (2,564 death runes, 1,282 soul runes…),
 * so the scaled points are capped there.
 */
export const COMMON_POINT_CAP = 51_285;

export function levelBonus(level: number): number {
  return level < 300 ? 1 : 1.15 + (0.01 * (level - 300)) / 5;
}

export function commonQty(e: ToaCommon, points: number, level: number): number {
  if (!e.divisor) return 1;
  const p = Math.min(COMMON_POINT_CAP, Math.max(0, points) * levelBonus(level));
  // The epsilon keeps 20,000 × 1.35 from flooring to 26,999.999….
  return Math.max(1, Math.floor(p / e.divisor + 1e-9));
}

export function clueChance(points: number): number {
  return Math.min(0.25, Math.max(0, points) / 2000 / 100);
}

/** Thread of Elidinis: 1/10, tripling linearly by 15 completions; 1/50 once you have one. */
export function threadChance(kc: number, haveOne: boolean): number {
  if (haveOne) return 1 / 50;
  return (1 / 10) * (1 + (2 * Math.min(kc, 15)) / 15);
}

/** Any keris jewel: 4/50, tripling linearly by 75 completions. */
export function jewelChance(kc: number): number {
  return (4 / 50) * (1 + (2 * Math.min(kc, 75)) / 75);
}

export interface ToaSettings extends RaidTeam {
  level: number;
}

/** Clamps everyone's points to the 64,000 cap (59,000 after the starting points). */
export function toaTeam(s: RaidTeam): RaidTeam {
  const size = Math.max(1, Math.round(s.size));
  const you = Math.min(MAX_EARNED, Math.max(0, s.you));
  return { size, you, total: Math.min(Math.max(you, s.total), you + (size - 1) * MAX_EARNED) };
}

export function makeToaRoller(s: ToaSettings): RaidRoller {
  const t = teamShape(toaTeam(s));
  const weights = [t.you, ...Array.from({ length: t.size - 1 }, () => t.other)];
  const table = uniqueTable(s.level);
  const pUnique = uniqueChance(t.total, s.level);
  const pPet = petChance(t.total, s.level);
  const pClue = clueChance(t.you);
  // Per-player tertiary state, fresh for each simulated player.
  let haveThread = false;
  const jewels = new Set<string>();
  return (rng: Rng, emit: Emit, raid: number) => {
    const kc = raid - 1;
    let teamUniques = 0;
    let yourUniques = 0;
    let purpleToYou = false;
    if (rng() < pUnique) {
      const who = pickRecipient(rng, weights);
      const item = pickWeighted(rng, table);
      const kept = s.level >= item.minLevel || rng() < LOW_LEVEL_KEEP;
      if (kept) teamUniques++;
      if (who === 0) {
        purpleToYou = true;
        if (kept) {
          yourUniques++;
          emit(item.name, 1);
        }
      }
    }
    if (rng() < pPet && pickRecipient(rng, weights) === 0) emit(PET, 1);
    if (!purpleToYou) {
      for (let r = 0; r < 3; r++) {
        const e = COMMON[Math.floor(rng() * COMMON.length)];
        emit(e.name, commonQty(e, t.you, s.level));
      }
    }
    if (rng() < pClue) emit(CLUE, 1);
    if (rng() < threadChance(kc, haveThread)) {
      haveThread = true;
      emit(THREAD, 1);
    }
    if (rng() < jewelChance(kc)) {
      const pool = jewels.size === JEWELS.length ? JEWELS : JEWELS.filter((j) => !jewels.has(j));
      const j = pool[Math.floor(rng() * pool.length)];
      jewels.add(j);
      emit(j, 1);
    }
    return { teamUniques, yourUniques };
  };
}

/** Your chances for one raid. */
export function toaChances(s: ToaSettings): { team: number; you: number; pet: number; youPet: number } {
  const t = teamShape(toaTeam(s));
  const share = t.total > 0 ? t.you / t.total : 0;
  const team = uniqueChance(t.total, s.level);
  const pet = petChance(t.total, s.level);
  return { team, you: team * share, pet, youPet: pet * share };
}

/** Chance a unique roll is kept once rolled (the low raid level 1/50 rule). */
export function keepChance(level: number): number {
  const table = uniqueTable(level);
  const w = table.reduce((a, e) => a + e.weight, 0);
  return table.reduce((a, e) => a + (e.weight / w) * (level >= e.minLevel ? 1 : LOW_LEVEL_KEEP), 0);
}

/** Expected GP per raid for you (tertiaries other than the clue left out). */
export function toaValuePerRaid(s: ToaSettings, price: (n: string) => number): { unique: number; common: number; other: number; total: number } {
  const t = teamShape(toaTeam(s));
  const { you } = toaChances(s);
  const table = uniqueTable(s.level);
  const w = table.reduce((a, e) => a + e.weight, 0);
  const uniqueAvg = table.reduce((a, e) => a + (e.weight / w) * (s.level >= e.minLevel ? 1 : LOW_LEVEL_KEEP) * price(e.name), 0);
  const commonAvg = (3 / COMMON.length) * COMMON.reduce((a, e) => a + commonQty(e, t.you, s.level) * price(e.name), 0);
  const unique = you * uniqueAvg;
  const common = (1 - you) * commonAvg;
  const other = clueChance(t.you) * price(CLUE);
  return { unique, common, other, total: unique + common + other };
}

export const TOA_UNIQUE_NAMES: string[] = [FANG, LIGHTBEARER, WARD, MASK, BODY, CHAPS, SHADOW, PET, THREAD, ...JEWELS];
export const TOA_ITEMS: string[] = [...TOA_UNIQUE_NAMES, CLUE, ...COMMON.map((c) => c.name)];

export const TOA_NOTES = [
  'Points here are reward points earned, without the 5,000 everyone starts with (the game subtracts those for loot). Each player is capped at 64,000 total, so 59,000 earned.',
  'Unique chance is 1% per 10,500 − 20×RL team points, capped at 55%. RL is the raid level up to 310, then each level above counts a third up to 430 and a sixth after that.',
  'Only one unique per raid. It goes to a player weighted by points; that player gets no common loot. Other players are assumed to split the rest of the team points evenly.',
  'Unique weights come from the wiki at raid levels 150–300, 350, 400, 450 and 500 (Fang and Lightbearer get rarer from 300). Levels in between are interpolated linearly, and levels above 500 use the 500 weights.',
  "Below raid level 50 (Fang, Lightbearer) or 150 (ward, Masori, Shadow), a rolled unique needs an extra 1/50 roll to keep it; otherwise an untradeable consolation item is given, which is not counted here.",
  'Without a unique you get three rolls on the 27-item common table (repeats allowed). Quantity is points ÷ divisor, with +15% at raid level 300 rising 1% per 5 levels. Quantities are capped at the wiki\'s listed maximums (51,285 coins).',
  'The pet rolls once per raid at 1% per 350,000 − 700×RL team points (RL capped at 450), and goes to a player weighted by points. Assumption: one pet roll per raid rather than per player.',
  'Tertiaries: elite clue 1% per 2,000 of your points (max 25%); Thread of Elidinis 1/10 rising to 3/10 by 15 completions, then 1/50 once owned; keris jewels 4/50 rising to 12/50 by 75 completions, with no duplicates until you have all four. Completions count from the first simulated raid.',
  'Not modelled: fossilised dung, the challenge rewards (Masori crafting kit, ornament kits, remnants, cursed phalanx) whose rates the wiki does not give.',
];
