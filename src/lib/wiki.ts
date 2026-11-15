// Live data from the OSRS Wiki and its real-time prices API, with a small local cache.

import { parseDropTables, pickSubtable, type ParsedTable } from './parsePage';

const WIKI_API = 'https://oldschool.runescape.wiki/api.php';
const PRICES_API = 'https://prices.runescape.wiki/api/v1/osrs';
/** Browsers cannot set User-Agent, so MediaWiki reads this header instead. */
const API_USER_AGENT = 'OSRSSims drop simulator (https://github.com/PhysicsSteven/OSRSSims)';

const PAGE_TTL = 24 * 60 * 60 * 1000;
const CACHE_VERSION = 'v1';

function cacheGet<T>(key: string, ttl: number): T | null {
  try {
    const raw = localStorage.getItem(`osrssims:${CACHE_VERSION}:${key}`);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw) as { t: number; v: T };
    return Date.now() - t < ttl ? v : null;
  } catch {
    return null;
  }
}

function cacheSet(key: string, v: unknown): void {
  try {
    localStorage.setItem(`osrssims:${CACHE_VERSION}:${key}`, JSON.stringify({ t: Date.now(), v }));
  } catch {
    // Storage full or blocked: the app still works, it just refetches.
  }
}

export function clearCache(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('osrssims:')) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

async function wikiGet(params: Record<string, string>): Promise<unknown> {
  const url = new URL(WIKI_API);
  for (const [k, v] of Object.entries({ format: 'json', formatversion: '2', origin: '*', ...params })) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'Api-User-Agent': API_USER_AGENT } });
  } catch {
    // If the custom header is refused in a CORS preflight, retry as a simple request.
    res = await fetch(url);
  }
  if (!res.ok) throw new Error(`OSRS Wiki returned HTTP ${res.status}`);
  return res.json();
}

export interface WikiPage {
  title: string;
  tables: ParsedTable[];
}

const inflight = new Map<string, Promise<WikiPage>>();

/** Fetches a wiki page (following redirects) and parses its drop tables. */
export function loadPage(title: string, opts: { fresh?: boolean } = {}): Promise<WikiPage> {
  const key = `page:${title.toLowerCase()}`;
  if (!opts.fresh) {
    const cached = cacheGet<WikiPage>(key, PAGE_TTL);
    if (cached) return Promise.resolve(cached);
    const pending = inflight.get(key);
    if (pending) return pending;
  }
  const p = (async () => {
    const data = (await wikiGet({ action: 'parse', page: title, prop: 'text', redirects: '1', disablelimitreport: '1' })) as {
      parse?: { title: string; text: string };
      error?: { info: string };
    };
    if (data.error) throw new Error(data.error.info);
    if (!data.parse) throw new Error('Unexpected response from the OSRS Wiki');
    const page: WikiPage = { title: data.parse.title, tables: parseDropTables(data.parse.text) };
    cacheSet(key, page);
    return page;
  })();
  inflight.set(key, p);
  p.finally(() => inflight.delete(key));
  return p;
}

export async function resolveSubtable(page: string, section?: string): Promise<ParsedTable | null> {
  const p = await loadPage(page);
  return pickSubtable(p.tables, page, section);
}

/** Title suggestions for the search box. */
export async function searchTitles(q: string): Promise<string[]> {
  if (q.trim().length < 2) return [];
  const data = (await wikiGet({ action: 'opensearch', search: q, namespace: '0', limit: '10', redirects: 'resolve' })) as [
    string,
    string[],
  ];
  return data[1] ?? [];
}

// ---------- prices ----------

interface MappingEntry {
  id: number;
  name: string;
  highalch?: number;
  value?: number;
}

export interface PriceBook {
  /** GP for one of the named item: GE mid price, or 0 if the item does not trade. */
  priceOf: (name: string) => number;
  isTradeable: (name: string) => boolean;
  updated: number;
}

const FIXED: Record<string, number> = { coins: 1, 'platinum token': 1000 };

export async function loadPrices(): Promise<PriceBook> {
  let mapping = cacheGet<MappingEntry[]>('mapping', PAGE_TTL);
  if (!mapping) {
    const res = await fetch(`${PRICES_API}/mapping`);
    if (!res.ok) throw new Error(`Prices API returned HTTP ${res.status}`);
    mapping = ((await res.json()) as MappingEntry[]).map(({ id, name, highalch, value }) => ({ id, name, highalch, value }));
    cacheSet('mapping', mapping);
  }
  let latest = cacheGet<Record<string, number>>('latest', 10 * 60 * 1000);
  if (!latest) {
    const res = await fetch(`${PRICES_API}/latest`);
    if (!res.ok) throw new Error(`Prices API returned HTTP ${res.status}`);
    const body = (await res.json()) as { data: Record<string, { high: number | null; low: number | null }> };
    latest = {};
    for (const [id, { high, low }] of Object.entries(body.data)) {
      const mid = high && low ? Math.round((high + low) / 2) : (high ?? low ?? 0);
      if (mid) latest[id] = mid;
    }
    cacheSet('latest', latest);
  }
  const byName = new Map<string, number>();
  for (const m of mapping) {
    const p = latest[String(m.id)];
    if (p) byName.set(m.name.toLowerCase(), p);
  }
  const norm = (n: string) => n.toLowerCase().replace(/\s*\((noted|un ?noted)\)$/, '').trim();
  return {
    priceOf: (name) => {
      const n = norm(name);
      return FIXED[n] ?? byName.get(n) ?? 0;
    },
    isTradeable: (name) => {
      const n = norm(name);
      return n in FIXED || byName.has(n);
    },
    updated: Date.now(),
  };
}
