import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildSource, itemRates, perUnitRate, uniqueItems, type DropSource } from './lib/model';
import type { LootLine } from './lib/sim';
import { chanceByNow, luckPercentile, normalCdf, percentileOf, quantile, valueMoments } from './lib/stats';
import { clearCache, loadPage, loadPrices, resolveSubtable, searchTitles, spriteUrl, type PriceBook } from './lib/wiki';
import type { WorkerRequest, WorkerResponse } from './worker';
import { gp, luckWord, oneIn, pct } from './format';
import { LuckBar, Sprite } from './ui';
import { DoomPanel } from './DoomPanel';
import { DOOM_ALIASES, DOOM_TITLE } from './lib/doom';

const PICKS: Array<{ group: string; items: string[] }> = [
  {
    group: 'Bosses',
    items: ['Zulrah', 'Vorkath', 'Cerberus', 'Kraken', 'General Graardor', "Kree'arra", 'Commander Zilyana', "K'ril Tsutsaroth", 'Corporeal Beast', 'Kalphite Queen', 'Callisto', 'Duke Sucellus', 'The Leviathan', 'Vardorvis', 'The Whisperer', 'Phantom Muspah', DOOM_TITLE],
  },
  { group: 'Slayer', items: ['Abyssal demon', 'Gargoyle', 'Kurask', 'Smoke devil', 'Dust devil', 'Hydra', 'Alchemical Hydra'] },
  {
    group: 'Clue caskets',
    items: ['Reward casket (beginner)', 'Reward casket (easy)', 'Reward casket (medium)', 'Reward casket (hard)', 'Reward casket (elite)', 'Reward casket (master)'],
  },
];

const THRESHOLDS = [
  { label: 'Rarer than 1/50', v: 1 / 50 },
  { label: 'Rarer than 1/100', v: 1 / 100 },
  { label: 'Rarer than 1/250', v: 1 / 250 },
  { label: 'Rarer than 1/500', v: 1 / 500 },
];

type Results = {
  mode: 'run' | 'complete';
  units: number;
  loot: LootLine[];
  samples: number[];
  trialUnits?: number[];
  complete?: boolean;
  source: string;
};

function readUrl(): { source?: string; kills?: number } {
  const q = new URLSearchParams(location.search);
  const kills = Number(q.get('kills'));
  return { source: q.get('source') ?? undefined, kills: kills > 0 ? kills : undefined };
}

export default function App() {
  const initial = useMemo(readUrl, []);
  const [query, setQuery] = useState(initial.source ?? '');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [title, setTitle] = useState<string | null>(initial.source ?? null);
  const [source, setSource] = useState<DropSource | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [prices, setPrices] = useState<PriceBook | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [units, setUnits] = useState(initial.kills ?? 1000);
  const [threshold, setThreshold] = useState(1 / 100);
  const [rollsOverride, setRollsOverride] = useState<number | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [running, setRunning] = useState(false);
  const [sort, setSort] = useState<'value' | 'qty' | 'name'>('value');
  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    loadPrices().then(setPrices, (e: Error) => setPriceError(e.message));
  }, []);

  useEffect(() => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    return () => w.terminate();
  }, []);

  // Search suggestions, debounced.
  useEffect(() => {
    if (!showSuggest) return;
    const t = setTimeout(() => {
      searchTitles(query).then(setSuggestions, () => setSuggestions([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query, showSuggest]);

  const load = useCallback(async (t: string, fresh = false) => {
    if (DOOM_ALIASES.test(t.trim())) {
      // Doom's loot is per delve level rather than a drop table, so it has its own module.
      setSource(null);
      setResults(null);
      setLoadError(null);
      setTitle(DOOM_TITLE);
      setQuery(DOOM_TITLE);
      const q = new URLSearchParams(location.search);
      q.set('source', DOOM_TITLE);
      q.delete('kills');
      history.replaceState(null, '', `?${q}`);
      return;
    }
    setLoading(true);
    setLoadError(null);
    setResults(null);
    setRollsOverride(null);
    try {
      const page = await loadPage(t, { fresh });
      if (!page.tables.length) throw new Error(`No drop tables found on the wiki page "${page.title}".`);
      const src = await buildSource(page.title, page.tables, resolveSubtable);
      setSource(src);
      setTitle(page.title);
      setQuery(page.title);
      const q = new URLSearchParams(location.search);
      q.set('source', page.title);
      history.replaceState(null, '', `?${q}`);
    } catch (e) {
      setSource(null);
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initial.source) void load(initial.source);
  }, [initial.source, load]);

  const effective = useMemo(() => {
    if (!source) return null;
    if (rollsOverride == null) return source;
    return { ...source, mainRolls: { min: rollsOverride, max: rollsOverride } };
  }, [source, rollsOverride]);

  const rates = useMemo(() => (effective ? itemRates(effective) : null), [effective]);
  const uniques = useMemo(() => (rates ? uniqueItems(rates, threshold) : []), [rates, threshold]);
  const priceOf = useCallback((n: string) => prices?.priceOf(n) ?? 0, [prices]);
  const moments = useMemo(() => (effective ? valueMoments(effective, priceOf) : null), [effective, priceOf]);

  const run = (mode: 'run' | 'complete') => {
    const w = workerRef.current;
    if (!w || !effective || !rates) return;
    const id = ++reqId.current;
    const priceMap: Record<string, number> = {};
    for (const name of rates.keys()) priceMap[name] = priceOf(name);
    const budget = 3_000_000;
    const req: WorkerRequest =
      mode === 'run'
        ? { type: 'run', id, src: effective, units: Math.max(1, Math.min(units, 2_000_000)), prices: priceMap, budget }
        : { type: 'complete', id, src: effective, items: uniques.map((u) => u.name), trials: 300, prices: priceMap, budget: 20_000_000 };
    setRunning(true);
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const res = ev.data;
      if (res.id !== reqId.current) return;
      setRunning(false);
      if (res.type === 'error') {
        setLoadError(res.message);
        return;
      }
      if (res.type === 'doom') return;
      setResults({
        mode: res.type,
        units: res.units,
        loot: res.loot,
        samples: res.samples,
        trialUnits: res.type === 'complete' ? res.trialUnits : undefined,
        complete: res.type === 'complete' ? res.complete : undefined,
        source: effective.title,
      });
      const q = new URLSearchParams(location.search);
      if (res.type === 'run') q.set('kills', String(res.units));
      history.replaceState(null, '', `?${q}`);
    };
    w.postMessage(req);
  };

  const unitWord = effective?.unit === 'casket' ? 'caskets' : 'kills';
  const unitWord1 = effective?.unit === 'casket' ? 'casket' : 'kill';

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>OSRS Drop Simulator</h1>
          <p className="sub">Drop tables and prices are read live from the OSRS Wiki, so they stay current on their own.</p>
        </div>
        <div className="status">
          {prices ? <span className="ok">Prices loaded</span> : priceError ? <span className="bad">Prices unavailable: {priceError}</span> : <span>Loading prices…</span>}
        </div>
      </header>

      <section className="panel picker">
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            setShowSuggest(false);
            if (query.trim()) void load(query.trim());
          }}
        >
          <input
            value={query}
            placeholder="Any monster, boss or reward casket on the wiki…"
            onChange={(e) => {
              setQuery(e.target.value);
              setShowSuggest(true);
            }}
            onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
            aria-label="Search the OSRS Wiki"
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Loading…' : 'Load'}
          </button>
          {showSuggest && suggestions.length > 0 && (
            <ul className="suggest">
              {suggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setShowSuggest(false);
                      void load(s);
                    }}
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>
        <div className="picks">
          {PICKS.map((g) => (
            <div key={g.group} className="pick-group">
              <span className="pick-label">{g.group}</span>
              {g.items.map((it) => (
                <button key={it} className={`chip ${title === it ? 'on' : ''}`} onClick={() => void load(it)}>
                  {it.replace('Reward casket ', '').replace(/[()]/g, '')}
                </button>
              ))}
            </div>
          ))}
        </div>
        {loadError && <p className="bad">{loadError}</p>}
      </section>

      {title === DOOM_TITLE && !source && !loading && <DoomPanel prices={prices} />}

      {effective && rates && (
        <section className="panel controls">
          <div className="source-head">
            <h2>
              <a href={`https://oldschool.runescape.wiki/w/${encodeURIComponent(effective.title.replace(/ /g, '_'))}`} target="_blank" rel="noreferrer">
                {effective.title}
              </a>
            </h2>
            <span className="muted">
              {rates.size} items · {uniques.length} collection log slots · expected {gp(moments?.mean ?? 0)} gp per {unitWord1}
            </span>
          </div>
          <div className="row">
            <label>
              <span>Number of {unitWord}</span>
              <input type="number" min={1} max={2000000} value={units} onChange={(e) => setUnits(Math.max(1, Number(e.target.value) || 1))} />
            </label>
            <div className="quick">
              {[1, 100, 500, 1000, 5000, 10000].map((n) => (
                <button key={n} className="chip" onClick={() => setUnits(n)}>
                  {n.toLocaleString()}
                </button>
              ))}
            </div>
            <label>
              <span>Collection log counts items</span>
              <select value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>
                {THRESHOLDS.map((t) => (
                  <option key={t.v} value={t.v}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Main table rolls per {unitWord1}</span>
              <input
                type="number"
                min={1}
                max={10}
                value={rollsOverride ?? ''}
                placeholder={
                  source!.mainRolls.min === source!.mainRolls.max ? String(source!.mainRolls.min) : `${source!.mainRolls.min}–${source!.mainRolls.max}`
                }
                onChange={(e) => setRollsOverride(e.target.value ? Math.max(1, Math.min(10, Number(e.target.value))) : null)}
              />
            </label>
          </div>
          <div className="row">
            <button className="primary" disabled={running} onClick={() => run('run')}>
              {running ? 'Simulating…' : `Simulate ${units.toLocaleString()} ${unitWord}`}
            </button>
            <button disabled={running || uniques.length === 0} onClick={() => run('complete')}>
              Simulate until collection log is complete
            </button>
          </div>
          {effective.notes.length > 0 && (
            <details className="notes">
              <summary>How this table was read ({effective.notes.length} notes)</summary>
              <ul>
                {effective.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </details>
          )}
          <details className="notes">
            <summary>Show the drop table as read from the wiki</summary>
            <div className="table-wrap">
              <table className="loot">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Type</th>
                    <th className="num">Per {unitWord1}</th>
                    <th className="num">Each GP</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(rates.values())
                    .sort((a, b) => perUnitRate(b) - perUnitRate(a))
                    .map((r) => (
                      <tr key={r.name}>
                        <td>
                          <span className="item">
                            <Sprite src={spriteUrl(r.name, r.image, prices?.iconOf(r.name))} />
                            {r.name}
                          </span>
                        </td>
                        <td>{r.pet ? 'pet' : r.tertiary ? 'tertiary' : r.direct ? 'main' : 'shared table'}</td>
                        <td className="num">{oneIn(perUnitRate(r))}</td>
                        <td className="num">{gp(priceOf(r.name))}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      )}

      {results && effective && rates && results.source === effective.title && (
        <ResultsView results={results} source={effective} rates={rates} uniques={uniques} priceOf={priceOf} prices={prices} moments={moments!} sort={sort} setSort={setSort} />
      )}

      <footer>
        Drop data from the <a href="https://oldschool.runescape.wiki/">Old School RuneScape Wiki</a> (CC BY-NC-SA 3.0). Prices from the{' '}
        <a href="https://prices.runescape.wiki/">OSRS Wiki real-time prices API</a>, using the midpoint of the latest buy and sell. Item sprites © Jagex, loaded from the wiki. Not affiliated with Jagex.{' '}
        <button
          className="link"
          onClick={() => {
            clearCache();
            location.reload();
          }}
        >
          Clear cached data
        </button>
      </footer>
    </div>
  );
}

function ResultsView(props: {
  results: Results;
  source: DropSource;
  rates: ReturnType<typeof itemRates>;
  uniques: ReturnType<typeof uniqueItems>;
  priceOf: (n: string) => number;
  prices: PriceBook | null;
  moments: { mean: number; variance: number };
  sort: 'value' | 'qty' | 'name';
  setSort: (s: 'value' | 'qty' | 'name') => void;
}) {
  const { results, source, rates, uniques, priceOf, prices, moments, sort, setSort } = props;
  const n = results.units;
  const unitWord = source.unit === 'casket' ? 'caskets' : 'kills';
  const unitAbbr = source.unit === 'casket' ? 'casket' : 'kc';
  const byName = new Map(results.loot.map((l) => [l.name, l]));
  const icon = (name: string) => spriteUrl(name, rates.get(name)?.image, prices?.iconOf(name));
  const total = results.loot.reduce((a, l) => a + l.qty * priceOf(l.name), 0);
  const expected = moments.mean * n;
  const gpLuck = results.samples.length
    ? percentileOf(results.samples, total)
    : moments.variance > 0
      ? normalCdf((total - expected) / Math.sqrt(moments.variance * n))
      : 0.5;
  const got = uniques.filter((u) => byName.has(u.name)).length;

  const lines = [...results.loot].sort((a, b) =>
    sort === 'name' ? a.name.localeCompare(b.name) : sort === 'qty' ? b.qty - a.qty : b.qty * priceOf(b.name) - a.qty * priceOf(a.name) || b.qty - a.qty,
  );

  const pets = uniques.filter((u) => u.pet);
  const trials = results.trialUnits ?? [];

  return (
    <>
      <section className="cards">
        <div className="card">
          <span className="k">Total loot</span>
          <span className="v">{gp(total)} gp</span>
          <span className="s">
            {gp(total / n)} gp per {source.unit === 'casket' ? 'casket' : 'kill'} over {n.toLocaleString()} {unitWord}
          </span>
        </div>
        <div className="card">
          <span className="k">Expected</span>
          <span className="v">{gp(expected)} gp</span>
          <span className="s">{gp(moments.mean)} gp per {source.unit === 'casket' ? 'casket' : 'kill'} on average</span>
        </div>
        <div className="card">
          <span className="k">GP luck</span>
          <span className="v">{Math.round(gpLuck * 100)}th percentile</span>
          <span className="s">
            {luckWord(gpLuck)}
            {results.samples.length ? ` (vs ${results.samples.length} simulated players)` : ' (normal approximation)'}
          </span>
        </div>
        <div className="card">
          <span className="k">Collection log</span>
          <span className="v">
            {got}/{uniques.length}
          </span>
          <span className="s">{uniques.length ? pct(got / uniques.length) : '—'} complete</span>
        </div>
      </section>

      {results.mode === 'complete' && (
        <section className="panel">
          <h3>Collection log completion</h3>
          {results.complete ? (
            <p>
              You finished the log at <b>{n.toLocaleString()}</b> {unitWord}.
              {trials.length > 0 && (
                <>
                  {' '}
                  Across {trials.length} simulated players the median was <b>{quantile(trials, 0.5).toLocaleString()}</b>, with 10% done by{' '}
                  {quantile(trials, 0.1).toLocaleString()} and 90% by {quantile(trials, 0.9).toLocaleString()}. You were faster than{' '}
                  <b>{pct(1 - percentileOf(trials, n))}</b> of them.
                </>
              )}
            </p>
          ) : (
            <p className="bad">Stopped after {n.toLocaleString()} {unitWord} without finishing. One of the items may be unobtainable from this table.</p>
          )}
        </section>
      )}

      {pets.length > 0 && (
        <section className="panel">
          <h3>Pet</h3>
          {pets.map((p) => {
            const line = byName.get(p.name);
            const r = perUnitRate(p);
            return (
              <p key={p.name} className="pet">
                <Sprite src={icon(p.name)} />
                <b>{p.name}</b> ({oneIn(r)} per {source.unit === 'casket' ? 'casket' : 'kill'}):{' '}
                {line ? (
                  <>
                    got it at {unitAbbr} <b>{line.first.toLocaleString()}</b>. {pct(chanceByNow(p, line.first))} of players have it by then.
                  </>
                ) : (
                  <>
                    no pet in {n.toLocaleString()} {unitWord}. {pct(chanceByNow(p, n))} of players would have it by now.
                  </>
                )}{' '}
                Half of players get it by {unitAbbr} {Math.ceil(Math.log(0.5) / Math.log1p(-Math.min(r, 0.999999))).toLocaleString()}.
              </p>
            );
          })}
        </section>
      )}

      {uniques.length > 0 && (
        <section className="panel">
          <h3>Collection log</h3>
          <div className="log">
            {uniques.map((u) => {
              const line = byName.get(u.name);
              const r = perUnitRate(u);
              const luck = luckPercentile(u, n, line?.drops ?? 0);
              return (
                <div key={u.name} className={`slot ${line ? 'got' : ''}`}>
                  <div className="slot-name">
                    <Sprite src={icon(u.name)} />
                    {u.name}
                  </div>
                  <div className="slot-meta">
                    <span>{oneIn(r)}</span>
                    <span>{line ? `×${line.drops} · first at ${line.first.toLocaleString()}` : 'not yet'}</span>
                  </div>
                  <div className="slot-meta">
                    <span className="muted">by now: {pct(chanceByNow(u, n))}</span>
                    <LuckBar value={luck} />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="muted small">The bar shows your luck percentile for how many of each item you got: 50 is average, higher is luckier.</p>
        </section>
      )}

      <section className="panel">
        <div className="table-head">
          <h3>Loot</h3>
          <div className="sorts">
            Sort by
            {(['value', 'qty', 'name'] as const).map((s) => (
              <button key={s} className={`chip ${sort === s ? 'on' : ''}`} onClick={() => setSort(s)}>
                {s === 'qty' ? 'quantity' : s}
              </button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          <table className="loot">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Quantity</th>
                <th className="num">Drops</th>
                <th className="num">Rate</th>
                <th className="num">Each</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const each = priceOf(l.name);
                const rate = rates.get(l.name);
                return (
                  <tr key={l.name}>
                    <td>
                      <span className="item">
                        <Sprite src={icon(l.name)} />
                        {l.name}
                      </span>
                    </td>
                    <td className="num">{l.qty.toLocaleString()}</td>
                    <td className="num">{l.drops.toLocaleString()}</td>
                    <td className="num">{rate ? oneIn(perUnitRate(rate)) : ''}</td>
                    <td className="num">{each ? gp(each) : prices && !prices.isTradeable(l.name) ? <span className="muted">untradeable</span> : '—'}</td>
                    <td className="num">{gp(l.qty * each)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
