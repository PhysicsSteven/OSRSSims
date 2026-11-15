// Turns a rendered OSRS Wiki page (HTML from action=parse) into structured drop tables.
// We read the rendered page instead of raw wikitext so that every template the wiki
// uses (shared tertiary tables, herb tables, ...) is already expanded for us.

import { cleanText, parseQuantity, parseRarity, type Quantity, type Rarity } from './parseText';

export type DropKind = 'always' | 'main' | 'tertiary' | 'pet';

export interface DropEntry {
  name: string;
  quantity: Quantity;
  quantityText: string;
  rarity: Rarity;
  rarityText: string;
  kind: DropKind;
  /** Section headings above the table, outermost first. */
  headings: string[];
  /** Set when the row is a roll on another table (rare drop table, gem drop table, ...). */
  subtable?: { page: string; section?: string };
}

export interface ParsedTable {
  headings: string[];
  entries: DropEntry[];
}

const SUBTABLE_RE = /(drop table|mega-rare|seed table|herb table)$/i;

function headingText(el: Element): string {
  const headline = el.querySelector('.mw-headline');
  const text = (headline ?? el).textContent ?? '';
  return cleanText(text.replace(/\[\s*edit( source)?\s*\]/gi, ''));
}

export function classify(headings: string[], rarity: Rarity): DropKind {
  const h = headings.join(' / ').toLowerCase();
  if (/\bpets?\b/.test(h)) return 'pet';
  if (/tertiary/.test(h)) return 'tertiary';
  if (rarity.always) return 'always';
  return 'main';
}

function linkTarget(a: HTMLAnchorElement | null): { page: string; section?: string } | null {
  if (!a) return null;
  const href = a.getAttribute('href') ?? '';
  const m = href.match(/\/w\/([^#?]+)(?:#(.+))?/);
  if (!m) {
    const t = a.getAttribute('title');
    return t ? { page: t } : null;
  }
  const page = decodeURIComponent(m[1]).replace(/_/g, ' ');
  const section = m[2] ? decodeURIComponent(m[2]).replace(/_/g, ' ') : undefined;
  return { page, section };
}

function findColumns(table: Element): { item: number; qty: number; rarity: number } | null {
  const headerRow = Array.from(table.querySelectorAll('tr')).find((tr) => tr.querySelector('th'));
  if (!headerRow) return null;
  const cells = Array.from(headerRow.children);
  let item = -1;
  let qty = -1;
  let rarity = -1;
  let col = 0;
  for (const c of cells) {
    const t = cleanText(c.textContent ?? '').toLowerCase();
    if (item < 0 && /^item/.test(t)) item = col;
    else if (qty < 0 && /^quantity/.test(t)) qty = col;
    else if (rarity < 0 && /^rarity/.test(t)) rarity = col;
    col += Number(c.getAttribute('colspan') ?? 1);
  }
  if (item < 0 || rarity < 0) return null;
  return { item, qty, rarity };
}

function rarityFromCell(td: Element): { rarity: Rarity; text: string } | null {
  const text = cleanText(td.textContent ?? '');
  const parsed = parseRarity(text);
  if (parsed) return { rarity: parsed, text };
  // The wiki exposes the fraction in data attributes for its rarity-display gadget.
  const span = td.querySelector('[data-drop-fraction],[data-drop-oneover]');
  for (const attr of ['data-drop-fraction', 'data-drop-oneover']) {
    const v = span?.getAttribute(attr);
    const p = v ? parseRarity(v) : null;
    if (p) return { rarity: p, text: v! };
  }
  const sort = Number(td.getAttribute('data-sort-value'));
  if (sort > 0 && sort <= 1) return { rarity: { p: sort, rolls: 1, always: sort === 1, approximate: false }, text };
  return null;
}

export function parseDropTables(html: string): ParsedTable[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: ParsedTable[] = [];
  const stack: Array<{ level: number; text: string }> = [];
  for (const el of Array.from(doc.querySelectorAll('h2, h3, h4, h5, table.item-drops'))) {
    const tag = el.tagName.toLowerCase();
    if (tag !== 'table') {
      const level = Number(tag[1]);
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, text: headingText(el) });
      continue;
    }
    const cols = findColumns(el);
    if (!cols) continue;
    const headings = stack.map((s) => s.text);
    const entries: DropEntry[] = [];
    for (const tr of Array.from(el.querySelectorAll('tr'))) {
      const tds = Array.from(tr.children).filter((c) => c.tagName.toLowerCase() === 'td');
      if (tds.length <= cols.rarity) continue;
      const itemCell = tds[cols.item];
      const link = itemCell.querySelector('a') as HTMLAnchorElement | null;
      const name = cleanText(link?.getAttribute('title') ?? itemCell.textContent ?? '');
      const shownName = cleanText(itemCell.textContent ?? '') || name;
      if (!name) continue;
      const r = rarityFromCell(tds[cols.rarity]);
      if (!r) continue;
      const quantityText = cols.qty >= 0 && tds[cols.qty] ? cleanText(tds[cols.qty].textContent ?? '') : '1';
      const entry: DropEntry = {
        name: shownName.length > 0 && shownName.length < 80 ? shownName.replace(/\s*\(.*noted.*\)$/i, '') : name,
        quantity: parseQuantity(quantityText),
        quantityText,
        rarity: r.rarity,
        rarityText: r.text,
        kind: classify(headings, r.rarity),
        headings,
      };
      if (SUBTABLE_RE.test(name) || SUBTABLE_RE.test(shownName)) {
        const target = linkTarget(link) ?? { page: name };
        entry.subtable = { page: target.page, section: target.section ?? (target.page === shownName ? undefined : shownName) };
      }
      entries.push(entry);
    }
    if (entries.length) out.push({ headings, entries });
  }
  return out;
}

/** Picks the table on a sub-table page that best matches the section we were sent to. */
export function pickSubtable(tables: ParsedTable[], page: string, section?: string): ParsedTable | null {
  if (!tables.length) return null;
  const want = (section ?? page).toLowerCase();
  const exact = tables.find((t) => t.headings.some((h) => h.toLowerCase() === want));
  if (exact) return exact;
  const loose = tables.find((t) => t.headings.some((h) => h.toLowerCase().includes(want) || want.includes(h.toLowerCase())));
  return loose ?? tables[0];
}
