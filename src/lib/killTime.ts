// Kill-time estimates: kills per hour per boss, and a player lookup, from Wise Old Man.
//
// The bundled rates are Wise Old Man's "efficient hours bossed" (EHB) tables (MIT licence,
// github.com/wise-old-man/wise-old-man, server/src/api/modules/efficiency/configs/ehb), copied
// 2026-11-16. They are what a maxed, efficient player gets, so most people land below them. The
// app refreshes them from the live API when it can, so changes to WOM's rates arrive on their own.

export type AccountType = 'main' | 'ironman' | 'ultimate' | 'def1';
export const ACCOUNT_TYPES: Array<{ v: AccountType; label: string }> = [
  { v: 'main', label: 'Main' },
  { v: 'ironman', label: 'Ironman' },
  { v: 'ultimate', label: 'Ultimate ironman' },
  { v: 'def1', label: '1 Defence pure' },
];

const ORDER: AccountType[] = ['main', 'ironman', 'ultimate', 'def1'];

/** Wise Old Man boss key → kills per hour as [main, ironman, ultimate, 1 defence]. */
const BUNDLED: Record<string, Array<number | null>> = {
  abyssal_sire: [50, 44, 38, 35],
  alchemical_hydra: [30, 29, 28, 25],
  amoxliatl: [85, 71, 65, 55],
  araxxor: [40, 38, 35, 25],
  artio: [60, 50, 42, 50],
  barrows_chests: [22, 22, 20, null],
  brutus: [250, 250, 250, 200],
  bryophyta: [9, 9, 7, null],
  callisto: [142, 142, 45, 85],
  calvarion: [55, 45, 40, 50],
  cerberus: [65, 54, 48, 48],
  chambers_of_xeric: [3.5, 3.5, 3, 2.9],
  chambers_of_xeric_challenge_mode: [3, 3, 2.5, 2.4],
  chaos_elemental: [120, 48, 38, 95],
  chaos_fanatic: [100, 80, 60, 100],
  commander_zilyana: [60, 30, 29, 26],
  corporeal_beast: [60, 10, 7.5, 60],
  crazy_archaeologist: [75, 95, 62, null],
  dagannoth_prime: [105, 100, 85, 75],
  dagannoth_rex: [105, 100, 85, 75],
  dagannoth_supreme: [105, 100, 85, 75],
  deranged_archaeologist: [80, 95, 85, null],
  doom_of_mokhaiotl: [20, 18, 16, 16],
  duke_sucellus: [39, 37, 35, 27],
  general_graardor: [58, 31, 30, 52],
  giant_mole: [125, 97, 85, 90],
  grotesque_guardians: [37, 34, 32, 23],
  hespori: [60, 50, 30, null],
  kalphite_queen: [55, 37, 33, 35],
  king_black_dragon: [130, 75, 55, 100],
  kraken: [100, 90, 80, 80],
  kreearra: [40, 30, 25, 23],
  kril_tsutsaroth: [65, 32, 28, 50],
  lunar_chests: [18, 18, 18, 18],
  mad_angel: [60, 60, 50, 33],
  maggot_king: [30, 30, 24, null],
  mimic: [60, 50, 25, null],
  nex: [23.5, 20, 12, 23],
  nightmare: [14, 11, 11, 12],
  obor: [12, 12, 10, null],
  phantom_muspah: [30, 27, 25, 20],
  phosanis_nightmare: [9.6, 9.3, 8.5, 7],
  sarachnis: [110, 67, 65, 80],
  scorpia: [130, 80, 38, 130],
  scurrius: [70, 60, 60, 50],
  shellbane_gryphon: [95, 95, 85, 60],
  skotizo: [45, 38, null, 30],
  sol_heredit: [2.7, 2.7, 2, 2],
  spindel: [55, 50, 40, 50],
  the_corrupted_gauntlet: [7.2, 7.2, 7.2, 6.5],
  the_gauntlet: [10, 10, 10, 9],
  the_hueycoatl: [20, 20, 20, 25],
  the_leviathan: [31, 27, 23, 22],
  the_royal_titans: [55, 55, 55, 50],
  the_whisperer: [22, 21, 20, 19],
  theatre_of_blood: [3.2, 3.2, 2.9, 2.9],
  theatre_of_blood_hard_mode: [3, 3, 2.6, 2.5],
  thermonuclear_smoke_devil: [150, 100, 88, 110],
  tombs_of_amascut: [3.7, 3.7, 3, 3],
  tombs_of_amascut_expert: [3, 3, 2.5, 2.5],
  tzkal_zuk: [1, 1, 0.8, 0.7],
  tztok_jad: [2.5, 2.2, 2, 1.7],
  vardorvis: [39, 37, 33, 25],
  venenatis: [80, 80, 35, 35],
  vetion: [50, 39, 35, 45],
  vorkath: [34, 34, 28, null],
  yama: [18, 18, 16, 16],
  zulrah: [46, 42, 36, 35],
};

/** Wiki titles that don't normalise to the WOM key on their own. */
const ALIASES: Array<[RegExp, string]> = [
  [/barrows/i, 'barrows_chests'],
  [/lunar chest/i, 'lunar_chests'],
  [/corrupted gauntlet/i, 'the_corrupted_gauntlet'],
  [/gauntlet/i, 'the_gauntlet'],
  [/chambers of xeric.*challenge/i, 'chambers_of_xeric_challenge_mode'],
  [/chambers of xeric/i, 'chambers_of_xeric'],
  [/theatre of blood.*hard/i, 'theatre_of_blood_hard_mode'],
  [/theatre of blood/i, 'theatre_of_blood'],
  [/tombs of amascut.*expert/i, 'tombs_of_amascut_expert'],
  [/tombs of amascut/i, 'tombs_of_amascut'],
  [/fortis colosseum|sol heredit/i, 'sol_heredit'],
  [/inferno|tzkal-zuk/i, 'tzkal_zuk'],
  [/fight caves|tztok-jad/i, 'tztok_jad'],
  [/dagannoth kings/i, 'dagannoth_rex'],
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '');

const BY_NORM = new Map(Object.keys(BUNDLED).map((k) => [norm(k), k]));

/** The Wise Old Man boss key for a wiki page title, or null when WOM has no rate for it. */
export function bossKeyFor(title: string): string | null {
  const t = title.trim();
  const direct = BY_NORM.get(norm(t)) ?? BY_NORM.get(norm(t.replace(/\s*\(.*\)\s*$/, '')));
  if (direct) return direct;
  for (const [re, key] of ALIASES) if (re.test(t)) return key;
  return null;
}

/** Rates fetched from the live API, by account type; they override the bundled ones. */
const live = new Map<AccountType, Map<string, number>>();

/** Reference kills per hour for this boss and account type, or null if there is none. */
export function referenceRate(key: string | null, type: AccountType): number | null {
  if (!key) return null;
  const fetched = live.get(type)?.get(key);
  if (fetched != null && fetched > 0) return fetched;
  const row = BUNDLED[key];
  if (!row) return null;
  // Some account types have no rate for a boss (e.g. no Vorkath for 1 Defence); fall back to main.
  const v = row[ORDER.indexOf(type)] ?? row[0];
  return v != null && v > 0 ? v : null;
}

const WOM = 'https://api.wiseoldman.net/v2';
const pending = new Map<AccountType, Promise<void>>();

/** Refresh one account type's rates from Wise Old Man. Failures keep the bundled table. */
export function refreshRates(type: AccountType): Promise<void> {
  let p = pending.get(type);
  if (!p) {
    p = fetch(`${WOM}/efficiency/rates?metric=ehb&type=${type}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((rows: unknown) => {
        if (!Array.isArray(rows)) return;
        const m = new Map<string, number>();
        for (const row of rows as Array<{ boss?: unknown; rate?: unknown }>) {
          if (typeof row.boss === 'string' && typeof row.rate === 'number') m.set(row.boss, row.rate);
        }
        if (m.size) live.set(type, m);
      })
      .catch(() => undefined);
    pending.set(type, p);
  }
  return p;
}

export type PlayerInfo = {
  name: string;
  accountType: AccountType;
  /** The WOM account type as shown to the user, e.g. "hardcore ironman". */
  typeLabel: string;
  combatLevel: number | null;
  /** Kill count by WOM boss key; -1 means below the hiscores cut-off. */
  kills: Record<string, number>;
  updatedAt: string | null;
};

/** Turn a Wise Old Man player-details response into what the app needs. */
export function parsePlayer(json: unknown): PlayerInfo {
  const p = json as {
    displayName?: string;
    username?: string;
    type?: string;
    build?: string;
    combatLevel?: number;
    updatedAt?: string;
    latestSnapshot?: { data?: { bosses?: Record<string, { kills?: number }> } } | null;
  };
  const type = p.type ?? 'regular';
  const build = p.build ?? 'main';
  const accountType: AccountType =
    type === 'ultimate' ? 'ultimate' : type === 'ironman' || type === 'hardcore' ? 'ironman' : build === 'def1' ? 'def1' : 'main';
  const typeLabel =
    type === 'hardcore' ? 'hardcore ironman' : type === 'ultimate' ? 'ultimate ironman' : type === 'ironman' ? 'ironman' : build === 'def1' ? '1 Defence pure' : 'main';
  const kills: Record<string, number> = {};
  for (const [k, v] of Object.entries(p.latestSnapshot?.data?.bosses ?? {})) {
    if (typeof v?.kills === 'number') kills[k] = v.kills;
  }
  return {
    name: p.displayName ?? p.username ?? '',
    accountType,
    typeLabel,
    combatLevel: typeof p.combatLevel === 'number' ? p.combatLevel : null,
    kills,
    updatedAt: p.updatedAt ?? null,
  };
}

/**
 * Look a player up on Wise Old Man. A player WOM doesn't track yet answers 404 to a read, so in
 * that case we ask WOM to track them, which reads their hiscores once.
 */
export async function lookupPlayer(name: string): Promise<PlayerInfo> {
  const url = `${WOM}/players/${encodeURIComponent(name.trim())}`;
  let res = await fetch(url);
  if (res.status === 404) res = await fetch(url, { method: 'POST' });
  if (res.status === 400 || res.status === 404) throw new Error(`No hiscores entry for "${name.trim()}".`);
  if (res.status === 429) throw new Error('Wise Old Man is rate limiting lookups. Try again in a minute.');
  if (!res.ok) throw new Error(`Wise Old Man lookup failed (HTTP ${res.status}).`);
  return parsePlayer(await res.json());
}

/** Format a number of hours: minutes under an hour, then hours, with days of play time when long. */
export function formatHours(h: number): string {
  if (!Number.isFinite(h) || h < 0) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 10) return `${h.toFixed(1)} h`;
  return `${Math.round(h).toLocaleString()} h`;
}
