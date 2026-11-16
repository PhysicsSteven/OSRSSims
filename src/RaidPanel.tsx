// Raid modules: Chambers of Xeric (points) and Tombs of Amascut (points and raid level).

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  COMMON as COX_COMMON,
  COMMON_POINT_CAP as COX_POINT_CAP,
  COX_ITEMS,
  COX_NOTES,
  COX_TITLE,
  COX_UNIQUE_NAMES,
  commonQty as coxQty,
  coxChances,
  coxValuePerRaid,
  rollChances,
  uniqueTable as coxTable,
  type CoxSettings,
} from './lib/cox';
import {
  COMMON as TOA_COMMON,
  commonQty as toaQty,
  keepChance,
  levelBonus,
  MAX_EARNED,
  petLevel,
  TOA_ITEMS,
  TOA_NOTES,
  TOA_TITLE,
  TOA_UNIQUE_NAMES,
  toaChances,
  toaTeam,
  toaValuePerRaid,
  uniqueLevel,
  uniqueTable as toaTable,
  type ToaSettings,
} from './lib/toa';
import type { RaidResult } from './lib/raid';
import { percentileOf } from './lib/stats';
import { spriteUrl, type PriceBook } from './lib/wiki';
import { gp, luckWord, oneIn, pct } from './format';
import { NumberInput, Sprite } from './ui';
import type { RaidSettings, WorkerRequest, WorkerResponse } from './worker';

type Sort = 'value' | 'qty' | 'name';
type Ran = { result: RaidResult; samples: number[]; expected: number; uniques: string[] };

function useRaidWorker() {
  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    return () => w.terminate();
  }, []);
  const run = (raid: RaidSettings, runs: number, prices: Record<string, number>, done: (r: RaidResult, samples: number[]) => void) => {
    const w = workerRef.current;
    if (!w) return;
    const id = ++reqId.current;
    const req: WorkerRequest = { type: 'raid', id, raid, runs, prices, budget: 3_000_000 };
    setRunning(true);
    setError(null);
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const res = ev.data;
      if (res.id !== reqId.current) return;
      setRunning(false);
      if (res.type === 'error') setError(res.message);
      else if (res.type === 'raid') done(res.result, res.samples);
    };
    w.postMessage(req);
  };
  return { run, running, error };
}

function priceMap(names: string[], priceOf: (n: string) => number): Record<string, number> {
  const m: Record<string, number> = {};
  for (const n of names) m[n] = priceOf(n);
  return m;
}

function Header({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="source-head">
      <h2>
        <a href={`https://oldschool.runescape.wiki/w/${title.replace(/ /g, '_')}`} target="_blank" rel="noreferrer">
          {title}
        </a>
      </h2>
      <span className="muted">{blurb}</span>
    </div>
  );
}

function RunsInput({ runs, setRuns }: { runs: number; setRuns: (n: number) => void }) {
  return (
    <>
      <label>
        <span>Number of raids</span>
        <NumberInput min={1} max={100000} value={runs} onChange={(v) => v != null && setRuns(Math.round(v))} />
      </label>
      <div className="quick">
        {[1, 10, 100, 500, 1000, 5000].map((n) => (
          <button key={n} className="chip" onClick={() => setRuns(n)}>
            {n.toLocaleString()}
          </button>
        ))}
      </div>
    </>
  );
}

function TeamInputs(props: { size: number; you: number; total: number; set: (t: { size: number; you: number; total: number }) => void; maxEach: number; pointsLabel: string }) {
  const { size, you, total, set, maxEach, pointsLabel } = props;
  return (
    <>
      <label>
        <span>Team size</span>
        <NumberInput min={1} max={100} value={size} onChange={(v) => v != null && set({ size: Math.round(v), you, total: size === 1 && v > 1 ? you * Math.round(v) : total })} />
      </label>
      <label>
        <span>{pointsLabel}</span>
        <NumberInput min={0} max={maxEach} step={1000} value={you} onChange={(v) => v != null && set({ size, you: v, total: size === 1 ? v : total })} />
      </label>
      {size > 1 && (
        <label>
          <span>Team total points</span>
          <NumberInput min={0} max={maxEach * 100} step={1000} value={total} onChange={(v) => v != null && set({ size, you, total: v })} />
        </label>
      )}
    </>
  );
}

function Notes({ title, notes }: { title: string; notes: string[] }) {
  return (
    <details className="notes">
      <summary>
        How {title} loot is modelled ({notes.length} notes)
      </summary>
      <ul>
        {notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
    </details>
  );
}

function Stat({ k, v, s }: { k: string; v: ReactNode; s: ReactNode }) {
  return (
    <div className="card">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
      <span className="s">{s}</span>
    </div>
  );
}

function UniqueRates({ rows, icon, priceOf }: { rows: Array<{ name: string; perRaid: number }>; icon: (n: string) => string; priceOf: (n: string) => number }) {
  return (
    <div className="table-wrap">
      <table className="loot">
        <thead>
          <tr>
            <th>Unique</th>
            <th className="num">Your chance per raid</th>
            <th className="num">Each GP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>
                <span className="item">
                  <Sprite src={icon(r.name)} />
                  {r.name}
                </span>
              </td>
              <td className="num">{oneIn(r.perRaid)}</td>
              <td className="num">{gp(priceOf(r.name))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CommonTable({ rows, icon, priceOf, perRoll }: { rows: Array<{ name: string; qty: number; noted?: boolean }>; icon: (n: string) => string; priceOf: (n: string) => number; perRoll: string }) {
  return (
    <div className="table-wrap">
      <table className="loot">
        <thead>
          <tr>
            <th>Common drop ({perRoll})</th>
            <th className="num">Qty at your points</th>
            <th className="num">Each GP</th>
            <th className="num">Stack GP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>
                <span className="item">
                  <Sprite src={icon(r.name)} />
                  {r.name}
                  {r.noted ? <span className="muted"> (noted)</span> : null}
                </span>
              </td>
              <td className="num">{r.qty.toLocaleString()}</td>
              <td className="num">{gp(priceOf(r.name))}</td>
              <td className="num">{gp(r.qty * priceOf(r.name))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- Chambers of Xeric

export function CoxPanel({ prices }: { prices: PriceBook | null }) {
  const [runs, setRuns] = useState(100);
  const [team, setTeam] = useState({ size: 1, you: 30_000, total: 30_000 });
  const [challengeMode, setCm] = useState(false);
  const [cmInTime, setInTime] = useState(true);
  const [ran, setRan] = useState<Ran | null>(null);
  const [sort, setSort] = useState<Sort>('value');
  const { run, running, error } = useRaidWorker();
  const priceOf = useCallback((n: string) => prices?.priceOf(n) ?? 0, [prices]);
  const icon = (n: string) => spriteUrl(n, undefined, prices?.iconOf(n));

  const s: CoxSettings = { ...team, challengeMode, cmInTime };
  const ch = coxChances(s);
  const value = coxValuePerRaid(s, priceOf);
  const rolls = rollChances(team.size === 1 ? team.you : Math.max(team.you, team.total));
  const table = coxTable(s);
  const w = table.reduce((a, e) => a + e.weight, 0);

  const go = () =>
    run({ kind: 'cox', ...s }, Math.max(1, Math.min(runs, 100_000)), priceMap(COX_ITEMS, priceOf), (result, samples) =>
      setRan({ result, samples, expected: value.total * result.runs, uniques: COX_UNIQUE_NAMES.filter((n) => challengeMode || (n !== 'Metamorphic dust' && n !== 'Twisted ancestral colour kit')) }),
    );

  return (
    <>
      <section className="panel controls">
        <Header title={COX_TITLE} blurb="Raid 1: unique chance comes from team points, and points decide who gets it." />
        <div className="row">
          <RunsInput runs={runs} setRuns={setRuns} />
        </div>
        <div className="row">
          <TeamInputs {...team} set={setTeam} maxEach={2_000_000} pointsLabel="Your points" />
          <div className="quick">
            <button className="chip" onClick={() => setTeam({ size: 1, you: 30_000, total: 30_000 })}>
              Solo 30k
            </button>
            <button className="chip" onClick={() => setTeam({ size: 3, you: 30_000, total: 90_000 })}>
              Trio 90k
            </button>
            <button className="chip" onClick={() => setTeam({ size: 5, you: 25_000, total: 125_000 })}>
              5-man 125k
            </button>
            <button className="chip" onClick={() => setTeam({ size: 1, you: 50_000, total: 50_000 })}>
              Solo CM 50k
            </button>
          </div>
        </div>
        <div className="row">
          <label className="check">
            <input type="checkbox" checked={challengeMode} onChange={(e) => setCm(e.target.checked)} />
            <span>Challenge mode</span>
          </label>
          {challengeMode && (
            <label className="check">
              <input type="checkbox" checked={cmInTime} onChange={(e) => setInTime(e.target.checked)} />
              <span>Finished inside the time limit (dust and kit can drop)</span>
            </label>
          )}
        </div>
        <div className="row">
          <button className="primary" disabled={running} onClick={go}>
            {running ? 'Simulating…' : `Simulate ${runs.toLocaleString()} raids`}
          </button>
        </div>
        {error && <p className="bad">{error}</p>}
        <Notes title="Chambers of Xeric" notes={COX_NOTES} />
        <details className="notes">
          <summary>Show the unique and common tables</summary>
          <UniqueRates rows={table.map((u) => ({ name: u.name, perRaid: (ch.you * u.weight) / w }))} icon={icon} priceOf={priceOf} />
          <CommonTable
            rows={COX_COMMON.map((e) => ({ name: e.name, qty: coxQty(e, team.you), noted: e.noted }))}
            icon={icon}
            priceOf={priceOf}
            perRoll="two different items, each 1/33"
          />
        </details>
      </section>

      <section className="cards">
        <Stat k="Team unique chance" v={pct(ch.anyUnique)} s={`${rolls.length > 1 ? `${rolls.length} rolls: ${rolls.map(pct).join(', ')}` : `${oneIn(ch.anyUnique)} per raid`} · ${ch.teamUniques.toFixed(2)} expected`} />
        <Stat k="Your unique chance" v={oneIn(ch.you)} s={`${pct(ch.you)} per raid with ${team.you.toLocaleString()} points`} />
        <Stat k="Expected GP per raid" v={`${gp(value.total)} gp`} s={`${gp(value.unique)} uniques · ${gp(value.common + value.other)} other`} />
        <Stat k="Points" v={team.you >= COX_POINT_CAP ? 'Common capped' : pct(Math.min(1, team.you / COX_POINT_CAP))} s={`of the 131,071 points where common loot stops growing`} />
      </section>

      {ran && <RaidResults ran={ran} priceOf={priceOf} prices={prices} sort={sort} setSort={setSort} />}
    </>
  );
}

// ---------------------------------------------------------------- Tombs of Amascut

const LEVEL_CHIPS = [0, 150, 300, 400, 500, 600];

export function ToaPanel({ prices }: { prices: PriceBook | null }) {
  const [runs, setRuns] = useState(100);
  const [level, setLevel] = useState(300);
  const [team, setTeam] = useState({ size: 1, you: 25_000, total: 25_000 });
  const [ran, setRan] = useState<Ran | null>(null);
  const [sort, setSort] = useState<Sort>('value');
  const { run, running, error } = useRaidWorker();
  const priceOf = useCallback((n: string) => prices?.priceOf(n) ?? 0, [prices]);
  const icon = (n: string) => spriteUrl(n, undefined, prices?.iconOf(n));

  const s: ToaSettings = { ...team, level };
  const ch = toaChances(s);
  const value = toaValuePerRaid(s, priceOf);
  const table = toaTable(level);
  const w = table.reduce((a, e) => a + e.weight, 0);
  const keep = keepChance(level);
  const clamped = toaTeam(s);
  const tier = level < 150 ? 'Entry' : level < 300 ? 'Normal' : 'Expert';

  const go = () =>
    run({ kind: 'toa', ...s }, Math.max(1, Math.min(runs, 100_000)), priceMap(TOA_ITEMS, priceOf), (result, samples) =>
      setRan({ result, samples, expected: value.total * result.runs, uniques: TOA_UNIQUE_NAMES }),
    );

  return (
    <>
      <section className="panel controls">
        <Header title={TOA_TITLE} blurb="Raid 3: unique chance comes from team points and the raid level your invocations add up to." />
        <div className="row">
          <RunsInput runs={runs} setRuns={setRuns} />
        </div>
        <div className="row">
          <label>
            <span>Raid level (from invocations)</span>
            <NumberInput min={0} max={600} step={5} value={level} onChange={(v) => v != null && setLevel(Math.round(v))} />
          </label>
          <div className="quick">
            {LEVEL_CHIPS.map((l) => (
              <button key={l} className={`chip ${level === l ? 'on' : ''}`} onClick={() => setLevel(l)}>
                {l}
              </button>
            ))}
          </div>
          <span className="muted small">
            {tier} · counts as {Math.round(uniqueLevel(level))} for uniques, {Math.round(petLevel(level))} for the pet · common loot ×{levelBonus(level).toFixed(2)}
          </span>
        </div>
        <div className="row">
          <TeamInputs {...team} set={setTeam} maxEach={MAX_EARNED} pointsLabel="Your points (without the starting 5,000)" />
          <div className="quick">
            <button className="chip" onClick={() => setTeam({ size: 1, you: 25_000, total: 25_000 })}>
              Solo 25k
            </button>
            <button className="chip" onClick={() => setTeam({ size: 3, you: 20_000, total: 60_000 })}>
              Trio 60k
            </button>
            <button className="chip" onClick={() => setTeam({ size: 8, you: 15_000, total: 120_000 })}>
              8-man 120k
            </button>
          </div>
        </div>
        {clamped.total !== (team.size === 1 ? team.you : team.total) || clamped.you !== team.you ? (
          <p className="muted small">Points over the 64,000 per player cap (59,000 earned) are ignored.</p>
        ) : null}
        <div className="row">
          <button className="primary" disabled={running} onClick={go}>
            {running ? 'Simulating…' : `Simulate ${runs.toLocaleString()} raids at level ${level}`}
          </button>
        </div>
        {error && <p className="bad">{error}</p>}
        <Notes title="Tombs of Amascut" notes={TOA_NOTES} />
        <details className="notes">
          <summary>Show the unique and common tables at this raid level</summary>
          <UniqueRates
            rows={table.map((u) => ({ name: u.name, perRaid: ((ch.you * u.weight) / w) * (level >= u.minLevel ? 1 : 1 / 50) }))}
            icon={icon}
            priceOf={priceOf}
          />
          <CommonTable
            rows={TOA_COMMON.map((e) => ({ name: e.name, qty: toaQty(e, clamped.you, level), noted: e.noted }))}
            icon={icon}
            priceOf={priceOf}
            perRoll="three rolls, each 1/27"
          />
        </details>
      </section>

      <section className="cards">
        <Stat k="Team purple chance" v={pct(ch.team)} s={`${oneIn(ch.team)} per raid${ch.team >= 0.55 ? ' (at the 55% cap)' : ''}`} />
        <Stat
          k="Your unique chance"
          v={oneIn(ch.you * keep)}
          s={keep < 1 ? `${pct(ch.you)} purple, but only ${pct(keep)} of rolls are kept below level 150` : `${pct(ch.you)} per raid`}
        />
        <Stat k="Pet chance" v={oneIn(ch.youPet)} s={`yours per raid · ${oneIn(ch.pet)} for the team`} />
        <Stat k="Expected GP per raid" v={`${gp(value.total)} gp`} s={`${gp(value.unique)} uniques · ${gp(value.common + value.other)} other`} />
      </section>

      {ran && <RaidResults ran={ran} priceOf={priceOf} prices={prices} sort={sort} setSort={setSort} />}
    </>
  );
}

// ---------------------------------------------------------------- results

function RaidResults(props: { ran: Ran; priceOf: (n: string) => number; prices: PriceBook | null; sort: Sort; setSort: (s: Sort) => void }) {
  const { ran, priceOf, prices, sort, setSort } = props;
  const { result, samples, expected, uniques } = ran;
  const icon = (n: string) => spriteUrl(n, undefined, prices?.iconOf(n));
  const n = result.runs;
  const total = result.loot.reduce((a, l) => a + l.qty * priceOf(l.name), 0);
  const byName = new Map(result.loot.map((l) => [l.name, l]));
  const luck = samples.length && prices ? percentileOf(samples, total) : null;
  const lines = [...result.loot].sort((a, b) =>
    sort === 'name' ? a.name.localeCompare(b.name) : sort === 'qty' ? b.qty - a.qty : b.qty * priceOf(b.name) - a.qty * priceOf(a.name) || b.qty - a.qty,
  );
  return (
    <>
      <section className="cards">
        <Stat k="Your loot" v={`${gp(total)} gp`} s={`${gp(total / n)} per raid over ${n.toLocaleString()} raids`} />
        <Stat k="Expected" v={`${gp(expected)} gp`} s="from the exact per-raid chances" />
        <Stat
          k="GP luck"
          v={luck == null ? '—' : `${Math.round(luck * 100)}th percentile`}
          s={luck == null ? (prices ? 'too many raids to compare' : 'needs prices') : `${luckWord(luck)} (vs ${samples.length} simulated players)`}
        />
        <Stat k="Purples" v={result.yourUniques.toLocaleString()} s={`yours · ${result.teamUniques.toLocaleString()} for the whole team`} />
      </section>

      <section className="panel">
        <h3>Collection log</h3>
        <div className="log">
          {uniques.map((name) => {
            const got = byName.get(name);
            return (
              <div key={name} className={`slot ${got ? 'got' : ''}`}>
                <div className="slot-name">
                  <Sprite src={icon(name)} />
                  {name}
                </div>
                <div className="slot-meta">
                  <span>{got ? `×${got.drops}` : 'not yet'}</span>
                  <span>{got ? `first on raid ${got.first.toLocaleString()}` : ''}</span>
                </div>
                <div className="slot-meta">
                  <span className="muted">{gp(priceOf(name))} gp</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="table-head">
          <h3>Your loot</h3>
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
