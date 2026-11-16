import { useEffect, useMemo, useState } from 'react';
import { ACCOUNT_TYPES, bossKeyFor, lookupPlayer, referenceRate, refreshRates, type AccountType, type PlayerInfo } from './lib/killTime';
import { NumberInput } from './ui';

/** What the results need to turn kills into time. */
export type Pace = {
  /** Kills (or caskets) per hour, or null when there's nothing to go on. */
  kph: number | null;
  /** The looked-up player's current kill count for this boss, when known. */
  kc: number | null;
};

const STORE = 'osrs-sim-pace';
type Saved = { accountType?: AccountType; efficiency?: number; username?: string; overrides?: Record<string, number> };

function readSaved(): Saved {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}') as Saved;
  } catch {
    return {};
  }
}

function writeSaved(s: Saved) {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    // Storage blocked (private window etc.): settings just won't persist.
  }
}

/**
 * Kills-per-hour controls under the simulator settings. The default rate is Wise Old Man's
 * efficient rate for the boss and account type, scaled by the player's efficiency; the player can
 * also type their own rate, which is remembered per page.
 */
export function PacePanel(props: { title: string; unit: 'kill' | 'casket'; onChange: (p: Pace) => void }) {
  const { title, unit, onChange } = props;
  const saved = useMemo(readSaved, []);
  const [accountType, setAccountType] = useState<AccountType>(saved.accountType ?? 'main');
  const [efficiency, setEfficiency] = useState<number>(saved.efficiency ?? 100);
  const [overrides, setOverrides] = useState<Record<string, number>>(saved.overrides ?? {});
  const [username, setUsername] = useState(saved.username ?? '');
  const [player, setPlayer] = useState<PlayerInfo | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [, setRatesTick] = useState(0);

  const key = unit === 'kill' ? bossKeyFor(title) : null;

  useEffect(() => {
    writeSaved({ accountType, efficiency, username, overrides });
  }, [accountType, efficiency, username, overrides]);

  useEffect(() => {
    let live = true;
    void refreshRates(accountType).then(() => live && setRatesTick((n) => n + 1));
    return () => {
      live = false;
    };
  }, [accountType]);

  const lookup = async (name: string) => {
    if (!name.trim()) return;
    setLooking(true);
    setLookupError(null);
    try {
      const p = await lookupPlayer(name);
      setPlayer(p);
      setAccountType(p.accountType);
    } catch (e) {
      setPlayer(null);
      setLookupError(e instanceof Error ? e.message : String(e));
    } finally {
      setLooking(false);
    }
  };

  // Look the saved player up again on the first visit of this session.
  useEffect(() => {
    if (saved.username) void lookup(saved.username);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ref = referenceRate(key, accountType);
  const scaled = ref != null ? Math.round(ref * (efficiency / 100) * 10) / 10 : null;
  const override = overrides[title] ?? null;
  const kph = override ?? scaled;
  const rawKc = key && player ? player.kills[key] : undefined;
  const kc = rawKc != null && rawKc >= 0 ? rawKc : null;

  useEffect(() => {
    onChange({ kph: kph != null && kph > 0 ? kph : null, kc });
  }, [kph, kc, onChange]);

  const perHour = unit === 'casket' ? 'Caskets per hour' : 'Kills per hour';
  const typeLabel = ACCOUNT_TYPES.find((t) => t.v === accountType)?.label.toLowerCase() ?? accountType;

  return (
    <div className="pace">
      <h3>Time to complete</h3>
      <div className="row">
        <label>
          <span>{perHour}</span>
          <NumberInput
            min={0.1}
            max={2000}
            step={0.1}
            allowEmpty
            value={override}
            placeholder={scaled != null ? String(scaled) : 'Your rate'}
            onChange={(v) =>
              setOverrides((o) => {
                const next = { ...o };
                if (v == null) delete next[title];
                else next[title] = v;
                return next;
              })
            }
          />
        </label>
        {key && (
          <>
            <label>
              <span>Account</span>
              <select value={accountType} onChange={(e) => setAccountType(e.target.value as AccountType)}>
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t.v} value={t.v}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Efficiency vs maxed (%)</span>
              <NumberInput min={5} max={150} value={efficiency} onChange={(v) => v != null && setEfficiency(Math.round(v))} />
            </label>
          </>
        )}
        <form
          className="lookup"
          onSubmit={(e) => {
            e.preventDefault();
            void lookup(username);
          }}
        >
          <label>
            <span>Your username (optional)</span>
            <input value={username} placeholder="RSN" onChange={(e) => setUsername(e.target.value)} />
          </label>
          <button type="submit" disabled={looking || !username.trim()}>
            {looking ? 'Looking up…' : 'Look up'}
          </button>
        </form>
      </div>
      <p className="muted small">
        {override != null ? (
          <>Using your own rate of {override} per hour. Clear the box to go back to the reference rate.</>
        ) : ref != null ? (
          <>
            Reference: {ref} kills per hour, Wise Old Man's efficient rate for a maxed {typeLabel}
            {efficiency !== 100 ? `, scaled to ${efficiency}%` : ''}. Most players are slower than this, so lower the efficiency or type your own
            rate.
          </>
        ) : (
          <>There is no reference rate for {title}, so type your own {perHour.toLowerCase()} to see times.</>
        )}
      </p>
      {lookupError && <p className="bad small">{lookupError}</p>}
      {player && (
        <p className="small">
          <b>{player.name}</b> ({player.typeLabel}
          {player.combatLevel ? `, combat ${player.combatLevel}` : ''}):{' '}
          {key
            ? rawKc == null
              ? 'no kill count on record for this boss.'
              : rawKc < 0
                ? 'kill count is below the hiscores cut-off for this boss.'
                : `${rawKc.toLocaleString()} kills on the hiscores.`
            : 'the hiscores don’t track kill count here.'}
        </p>
      )}
    </div>
  );
}
