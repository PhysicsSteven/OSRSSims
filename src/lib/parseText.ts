// Parsing of the human-readable rarity and quantity strings the OSRS Wiki shows in drop tables.

export interface Rarity {
  /** Probability per roll (0..1). 1 for "Always". */
  p: number;
  /** Number of independent rolls the wiki lists, e.g. "2 × 1/128" gives 2. */
  rolls: number;
  always: boolean;
  /** True when the wiki gave a word ("Rare") or "~", so the number is our estimate. */
  approximate: boolean;
}

// The wiki's word rarities, used when no fraction is given. These follow the wiki's
// own colour bands (Common ≥ 1/25, Uncommon 1/25..1/99, Rare 1/100..1/999, Very rare < 1/1000).
const WORD_RARITY: Record<string, number> = {
  always: 1,
  common: 1 / 16,
  uncommon: 1 / 64,
  rare: 1 / 256,
  'very rare': 1 / 2048,
};

function num(s: string): number {
  return Number(s.replace(/[,\s]/g, ''));
}

/** Removes reference markers like "[1]", "[d 1]" and footnote daggers. */
export function cleanText(s: string): string {
  return s
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[†‡*]/g, '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseRarity(raw: string): Rarity | null {
  let s = cleanText(raw).toLowerCase();
  if (!s) return null;
  let approximate = false;
  if (s.startsWith('~')) {
    approximate = true;
    s = s.slice(1).trim();
  }
  let rolls = 1;
  const rollMatch = s.match(/^(\d+)\s*[×x]\s*(.+)$/);
  if (rollMatch) {
    rolls = Number(rollMatch[1]);
    s = rollMatch[2].trim();
    if (s.startsWith('~')) {
      approximate = true;
      s = s.slice(1).trim();
    }
  }
  if (s.startsWith('always')) return { p: 1, rolls, always: true, approximate };
  // Fraction, possibly with decimals: "1/128", "2.5/128", "1/1,000"
  const frac = s.match(/^([\d.,]+)\s*\/\s*([\d.,]+)/);
  if (frac) {
    const n = num(frac[1]);
    const d = num(frac[2]);
    if (d > 0 && n >= 0) return { p: Math.min(1, n / d), rolls, always: n >= d, approximate };
  }
  const pct = s.match(/^([\d.]+)\s*%/);
  if (pct) return { p: Number(pct[1]) / 100, rolls, always: Number(pct[1]) >= 100, approximate };
  for (const word of ['very rare', 'uncommon', 'common', 'rare']) {
    if (s.startsWith(word)) return { p: WORD_RARITY[word], rolls, always: false, approximate: true };
  }
  return null;
}

export interface Quantity {
  /** Each option is an inclusive range; one option is picked uniformly, then a value in its range. */
  options: Array<[number, number]>;
  noted: boolean;
}

export function parseQuantity(raw: string): Quantity {
  let s = cleanText(raw).toLowerCase();
  const noted = /noted/.test(s);
  s = s.replace(/\(.*?\)/g, ' ').replace(/noted/g, ' ');
  const options: Array<[number, number]> = [];
  // Options are separated by ";" or "," followed by a space (a "," inside a number has no space).
  for (const part of s.split(/;|,\s+|\s+or\s+/)) {
    const p = part.trim();
    if (!p) continue;
    const range = p.match(/^([\d,]+)\s*[–—-]\s*([\d,]+)/);
    if (range) {
      const a = num(range[1]);
      const b = num(range[2]);
      if (Number.isFinite(a) && Number.isFinite(b)) options.push([Math.min(a, b), Math.max(a, b)]);
      continue;
    }
    const single = p.match(/^([\d,]+)/);
    if (single) {
      const v = num(single[1]);
      if (Number.isFinite(v)) options.push([v, v]);
    }
  }
  if (options.length === 0) options.push([1, 1]);
  return { options, noted };
}

export function meanQuantity(q: Quantity): number {
  return q.options.reduce((acc, [a, b]) => acc + (a + b) / 2, 0) / q.options.length;
}

/** E[X^2] for the quantity distribution, used for variance of GP per kill. */
export function meanSquareQuantity(q: Quantity): number {
  return (
    q.options.reduce((acc, [a, b]) => {
      // Discrete uniform on a..b: E[X^2] = ((b-a+1)^2 - 1)/12 + ((a+b)/2)^2
      const n = b - a + 1;
      const m = (a + b) / 2;
      return acc + (n * n - 1) / 12 + m * m;
    }, 0) / q.options.length
  );
}
