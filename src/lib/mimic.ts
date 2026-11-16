// The Mimic: a 1/35 (elite) or 1/15 (master) chance that a reward casket is a Mimic,
// once the player has enabled Mimic encounters with the strange casket.
//
// The casket's own reward rolls are unchanged; killing the Mimic adds its own loot on top.
// The wiki keeps that loot on The Mimic page in a pre-roll + main-table shape that does not
// match a normal drop table, so the rates are written out here (OSRS Wiki, The Mimic,
// "Elite drops" / "Master drops", from the Drop Rate Project). We assume the Mimic dies on
// the first attempt, which gives the full quantities and the first-attempt rates.

import { makePool, type Independent, type Leaf, type Outcome } from './model';

export type MimicTier = 'elite' | 'master';

export const MIMIC_CHANCE: Record<MimicTier, number> = { elite: 1 / 35, master: 1 / 15 };

/** First-attempt pre-roll and main-drop rates per tier. */
const RATES: Record<MimicTier, { thirdAge: number; ring: number; main: number }> = {
  elite: { thirdAge: 1 / 250, ring: 6 / 250, main: 243 / 1250 },
  master: { thirdAge: 1 / 228, ring: 6 / 228, main: 221 / 1140 },
};

const THIRD_AGE = [
  '3rd age full helmet', '3rd age platebody', '3rd age platelegs', '3rd age plateskirt', '3rd age kiteshield',
  '3rd age range coif', '3rd age range top', '3rd age range legs', '3rd age vambraces',
  '3rd age mage hat', '3rd age robe top', '3rd age robe', '3rd age amulet',
  '3rd age longsword', '3rd age bow', '3rd age wand', '3rd age cloak',
  '3rd age druidic robe top', '3rd age druidic robe bottoms', '3rd age druidic cloak', '3rd age druidic staff',
  '3rd age pickaxe', '3rd age axe',
];

const MAIN: Array<[string, number, boolean]> = [
  ['Death rune', 600, false],
  ['Blood rune', 500, false],
  ['Grimy ranarr weed', 25, true],
  ['Wine of zamorak', 25, true],
  ['Raw manta ray', 15, true],
];

function leaf(name: string, qty = 1, noted = false): Leaf {
  return { name, quantity: { options: [[qty, qty]], noted }, noted };
}

function fmt(p: number): string {
  return `1/${Math.round(1 / p).toLocaleString()}`;
}

/** The Mimic as an independent per-casket roll: its chance to appear, then its loot. */
export function mimicEncounter(tier: MimicTier, notes: string[]): Independent {
  const r = RATES[tier];
  const each = r.thirdAge / THIRD_AGE.length;
  const thirdAge = makePool(
    'Mimic 3rd age',
    THIRD_AGE.map((n) => ({ p: 1 / THIRD_AGE.length, leaf: leaf(n), label: n, rarityText: fmt(each) })),
    notes,
  );
  const outcomes: Outcome[] = [
    { p: r.thirdAge, sub: thirdAge, label: '3rd age item', rarityText: fmt(r.thirdAge) },
    { p: r.ring, leaf: leaf('Ring of 3rd age'), label: 'Ring of 3rd age', rarityText: fmt(r.ring) },
    ...MAIN.map(([n, q, noted]) => ({ p: r.main, leaf: leaf(n, q, noted), label: n, rarityText: fmt(r.main) })),
  ];
  const p = MIMIC_CHANCE[tier];
  return {
    p,
    rolls: 1,
    kind: 'mimic',
    also: [leaf('Mahogany plank')],
    outcome: { p, sub: makePool('Mimic loot', outcomes, notes), label: 'The Mimic', rarityText: fmt(p) },
  };
}

export function mimicNote(tier: MimicTier): string {
  return (
    `Mimic encounters are on: each ${tier} casket has a ${fmt(MIMIC_CHANCE[tier])} chance to be a Mimic. ` +
    'Killing it adds its own loot (one Mahogany plank plus one roll on its table) on top of the casket. ' +
    'The Mimic is assumed to die on the first attempt, and the one-time guaranteed Mimic and the Mimic scroll case are not simulated.'
  );
}
