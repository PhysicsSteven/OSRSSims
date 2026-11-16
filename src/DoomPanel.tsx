// The Doom of Mokhaiotl module: delve-by-delve loot with a pile you can lose by dying.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  anyUniqueChance,
  CLUE,
  COMMON,
  COMMON_TOTAL,
  DEFAULT_DEATH,
  depthTable,
  DOOM_ITEMS,
  DOOM_NOTES,
  DOOM_TITLE,
  guaranteedTears,
  MAX_RATE_LEVEL,
  meanCommonQty,
  PET,
  petChance,
  QTY_MULT,
  UNIQUE_NAMES,
  uniqueChance,
  type DoomResult,
  type DoomStrategy,
} from './lib/doom';
import { percentileOf } from './lib/stats';
import { spriteUrl, type PriceBook } from './lib/wiki';
import { gp, luckWord, oneIn, pct } from './format';
import { NumberInput, Sprite } from './ui';
import type { WorkerRequest, WorkerResponse } from './worker';

const LEVELS = Array.from({ length: MAX_RATE_LEVEL }, (_, i) => i + 1);
const levelLabel = (l: number) => (l === MAX_RATE_LEVEL ? `${l}+` : String(l));

export function DoomPanel({ prices }: { prices: PriceBook | null }) {
  const [runs, setRuns] = useState(100);
  const [claimAfter, setClaimAfter] = useState(8);
  const [stopOnUnique, setStopOnUnique] = useState(false);
  const [deathPct, setDeathPct] = useState<number[]>(DEFAULT_DEATH.map((d) => d * 100));
  const [result, setResult] = useState<{ result: DoomResult; samples: number[]; strategy: DoomStrategy } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<'value' | 'qty' | 'name'>('value');
  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    return () => w.terminate();
  }, []);

  const priceOf = useCallback((n: string) => prices?.priceOf(n) ?? 0, [prices]);
  const death = useMemo(() => deathPct.map((d) => Math.max(0, Math.min(100, d)) / 100), [deathPct]);
  const strategy: DoomStrategy = { claimAfter, stopOnUnique, death };
  const rows = useMemo(() => depthTable(death, priceOf, 12), [death, priceOf]);
  const bestGpPerLevel = rows.reduce((b, r) => (r.gpPerLevel > b.gpPerLevel ? r : b), rows[0]);
  const icon = (n: string) => spriteUrl(n, undefined, prices?.iconOf(n));

  const run = () => {
    const w = workerRef.current;
    if (!w) return;
    const id = ++reqId.current;
    const priceMap: Record<string, number> = {};
    for (const n of DOOM_ITEMS) priceMap[n] = priceOf(n);
    const req: WorkerRequest = { type: 'doom', id, strategy, runs: Math.max(1, Math.min(runs, 200_000)), prices: priceMap, budget: 3_000_000 };
    setRunning(true);
    setError(null);
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const res = ev.data;
      if (res.id !== reqId.current) return;
      setRunning(false);
      if (res.type === 'error') setError(res.message);
      else if (res.type === 'doom') setResult({ result: res.result, samples: res.samples, strategy: req.strategy });
    };
    w.postMessage(req);
  };

  return (
    <>
      <section className="panel controls">
        <div className="source-head">
          <h2>
            <a href="https://oldschool.runescape.wiki/w/Doom_of_Mokhaiotl" target="_blank" rel="noreferrer">
              {DOOM_TITLE}
            </a>
          </h2>
          <span className="muted">Delve boss: loot piles up each level and is lost if you die before claiming it.</span>
        </div>
        <div className="row">
          <label>
            <span>Number of runs</span>
            <NumberInput min={1} max={200000} value={runs} onChange={(v) => v != null && setRuns(Math.round(v))} />
          </label>
          <div className="quick">
            {[1, 10, 100, 500, 1000, 5000].map((n) => (
              <button key={n} className="chip" onClick={() => setRuns(n)}>
                {n.toLocaleString()}
              </button>
            ))}
          </div>
          <label>
            <span>Claim loot after delve</span>
            <NumberInput min={1} max={50} value={claimAfter} onChange={(v) => v != null && setClaimAfter(Math.round(v))} />
          </label>
          <label className="check">
            <input type="checkbox" checked={stopOnUnique} onChange={(e) => setStopOnUnique(e.target.checked)} />
            <span>Claim early when a unique drops</span>
          </label>
        </div>
        <div className="row">
          <div className="death">
            <span className="muted small">Chance to die on each delve (%)</span>
            <div className="death-grid">
              {LEVELS.map((l, i) => (
                <label key={l}>
                  <span>{levelLabel(l)}</span>
                  <NumberInput
                    min={0}
                    max={100}
                    step={0.5}
                    value={deathPct[i]}
                    onChange={(v) => v != null && setDeathPct((d) => d.map((x, j) => (j === i ? v : x)))}
                  />
                </label>
              ))}
            </div>
            <div className="quick">
              <button className="chip" onClick={() => setDeathPct(LEVELS.map(() => 0))}>
                Never die
              </button>
              <button className="chip" onClick={() => setDeathPct(DEFAULT_DEATH.map((d) => d * 100))}>
                Default
              </button>
              <button className="chip" onClick={() => setDeathPct([0, 0, 1, 2, 4, 6, 8, 12, 15])}>
                Learning
              </button>
            </div>
          </div>
        </div>
        <div className="row">
          <button className="primary" disabled={running} onClick={run}>
            {running ? 'Simulating…' : `Simulate ${runs.toLocaleString()} runs to delve ${claimAfter}`}
          </button>
        </div>
        {error && <p className="bad">{error}</p>}
        <details className="notes">
          <summary>How Doom's loot is modelled ({DOOM_NOTES.length} notes)</summary>
          <ul>
            {DOOM_NOTES.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
        <details className="notes">
          <summary>Show the per-delve rates</summary>
          <div className="table-wrap">
            <table className="loot">
              <thead>
                <tr>
                  <th>Delve</th>
                  {UNIQUE_NAMES.map((n) => (
                    <th key={n} className="num">
                      {n.replace(' (uncharged)', '')}
                    </th>
                  ))}
                  <th className="num">Any unique</th>
                  <th className="num">{PET}</th>
                  <th className="num">Demon tears</th>
                  <th className="num">Common qty</th>
                </tr>
              </thead>
              <tbody>
                {LEVELS.map((l) => (
                  <tr key={l}>
                    <td>{levelLabel(l)}</td>
                    {UNIQUE_NAMES.map((n) => (
                      <td key={n} className="num">
                        {uniqueChance(n, l) ? oneIn(uniqueChance(n, l)) : '—'}
                      </td>
                    ))}
                    <td className="num">{anyUniqueChance(l) ? oneIn(anyUniqueChance(l)) : '—'}</td>
                    <td className="num">{petChance(l) ? oneIn(petChance(l)) : '—'}</td>
                    <td className="num">{guaranteedTears(l) || '—'}</td>
                    <td className="num">{`${QTY_MULT[l - 1] >= 0 ? '+' : '−'}${Math.round(Math.abs(QTY_MULT[l - 1]) * 100)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-wrap">
            <table className="loot">
              <thead>
                <tr>
                  <th>Common drop (one roll per delve)</th>
                  <th className="num">Rate</th>
                  <th className="num">Avg qty at delve 3</th>
                  <th className="num">Each GP</th>
                </tr>
              </thead>
              <tbody>
                {COMMON.map((e, i) => (
                  <tr key={e.name}>
                    <td>
                      <span className="item">
                        <Sprite src={icon(e.name)} />
                        {e.name}
                        {e.noted ? <span className="muted"> (noted)</span> : null}
                      </span>
                    </td>
                    <td className="num">{oneIn(e.weight / COMMON_TOTAL)}</td>
                    <td className="num">{meanCommonQty(i, 3).toFixed(1)}</td>
                    <td className="num">{gp(priceOf(e.name))}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <span className="item">
                      <Sprite src={icon(CLUE)} />
                      {CLUE}
                    </span>
                  </td>
                  <td className="num">1/75, then 1/50</td>
                  <td className="num">1</td>
                  <td className="num">—</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className="panel">
        <h3>How deep should you go?</h3>
        <p className="muted small">
          Expected results for always claiming after a given delve, using your death chances and live prices. Levels per run counts the level you die on.
          Click a row to use it.
        </p>
        <div className="table-wrap">
          <table className="loot depth">
            <thead>
              <tr>
                <th>Claim after</th>
                <th className="num">Survive</th>
                <th className="num">Levels per run</th>
                <th className="num">GP per run</th>
                <th className="num">GP per level</th>
                <th className="num">Unique per run</th>
                <th className="num">{PET} per run</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.claimAfter}
                  className={`${r.claimAfter === claimAfter ? 'sel' : ''} ${r === bestGpPerLevel && r.gpPerLevel > 0 ? 'best' : ''}`}
                  onClick={() => setClaimAfter(r.claimAfter)}
                >
                  <td>
                    Delve {r.claimAfter}
                    {r === bestGpPerLevel && r.gpPerLevel > 0 ? <span className="tag">best GP per level</span> : null}
                  </td>
                  <td className="num">{pct(r.survive)}</td>
                  <td className="num">{r.levelsPerRun.toFixed(2)}</td>
                  <td className="num">{gp(r.gpPerRun)}</td>
                  <td className="num">{gp(r.gpPerLevel)}</td>
                  <td className="num">{r.uniquesPerRun ? oneIn(r.uniquesPerRun) : '—'}</td>
                  <td className="num">{r.petPerRun ? oneIn(r.petPerRun) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">GP per level is a rough stand-in for GP per hour, since deeper levels take longer to kill.</p>
      </section>

      {result && <DoomResults {...result} priceOf={priceOf} prices={prices} sort={sort} setSort={setSort} />}
    </>
  );
}

function DoomResults(props: {
  result: DoomResult;
  samples: number[];
  strategy: DoomStrategy;
  priceOf: (n: string) => number;
  prices: PriceBook | null;
  sort: 'value' | 'qty' | 'name';
  setSort: (s: 'value' | 'qty' | 'name') => void;
}) {
  const { result, samples, strategy, priceOf, prices, sort, setSort } = props;
  const icon = (n: string) => spriteUrl(n, undefined, prices?.iconOf(n));
  const claimedGp = result.claimed.reduce((a, l) => a + l.qty * priceOf(l.name), 0);
  const lostGp = result.lost.reduce((a, l) => a + l.qty * priceOf(l.name), 0);
  const byName = new Map(result.claimed.map((l) => [l.name, l]));
  const lostByName = new Map(result.lost.map((l) => [l.name, l]));
  const luck = samples.length && prices ? percentileOf(samples, claimedGp) : null;
  const lines = [...result.claimed].sort((a, b) =>
    sort === 'name' ? a.name.localeCompare(b.name) : sort === 'qty' ? b.qty - a.qty : b.qty * priceOf(b.name) - a.qty * priceOf(a.name) || b.qty - a.qty,
  );
  const n = result.runs;

  return (
    <>
      <section className="cards">
        <div className="card">
          <span className="k">Claimed loot</span>
          <span className="v">{gp(claimedGp)} gp</span>
          <span className="s">
            {gp(claimedGp / n)} per run · {gp(claimedGp / Math.max(1, result.levelsFought))} per level fought
          </span>
        </div>
        <div className="card">
          <span className="k">Lost to deaths</span>
          <span className="v">{gp(lostGp)} gp</span>
          <span className="s">
            {result.deaths.toLocaleString()} of {n.toLocaleString()} runs ended in death ({pct(result.deaths / n)})
          </span>
        </div>
        <div className="card">
          <span className="k">GP luck</span>
          <span className="v">{luck == null ? '—' : `${Math.round(luck * 100)}th percentile`}</span>
          <span className="s">{luck == null ? (prices ? 'too many runs to compare' : 'needs prices') : `${luckWord(luck)} (vs ${samples.length} simulated players)`}</span>
        </div>
        <div className="card">
          <span className="k">Levels</span>
          <span className="v">{result.levelsCleared.toLocaleString()}</span>
          <span className="s">
            cleared, {result.levelsFought.toLocaleString()} fought, claiming after delve {strategy.claimAfter}
            {strategy.stopOnUnique ? ' or a unique' : ''}
          </span>
        </div>
      </section>

      <section className="panel">
        <h3>Uniques</h3>
        <div className="log">
          {[...UNIQUE_NAMES, PET].map((name) => {
            const got = byName.get(name);
            const lost = lostByName.get(name);
            return (
              <div key={name} className={`slot ${got ? 'got' : ''}`}>
                <div className="slot-name">
                  <Sprite src={icon(name)} />
                  {name}
                </div>
                <div className="slot-meta">
                  <span>{got ? `×${got.drops} claimed` : 'not yet'}</span>
                  <span>{got ? `first on run ${got.first.toLocaleString()}` : ''}</span>
                </div>
                <div className="slot-meta">
                  <span className={lost ? 'bad' : 'muted'}>{lost ? `×${lost.drops} lost on death` : 'none lost'}</span>
                  <span className="muted">{gp(priceOf(name))} gp</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="table-head">
          <h3>Claimed loot</h3>
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
                <th className="num">Lost</th>
                <th className="num">Each</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const each = priceOf(l.name);
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
                    <td className="num muted">{lostByName.get(l.name)?.qty.toLocaleString() ?? ''}</td>
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
