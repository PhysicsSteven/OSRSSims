import { useState } from 'react';
import { pct } from './format';

export function LuckBar({ value }: { value: number }) {
  return (
    <span className="luck" title={`Luckier than ${pct(value)} of players`}>
      <span className="luck-track">
        <span className="luck-dot" style={{ left: `${value * 100}%` }} />
      </span>
      <span className="luck-num">{Math.round(value * 100)}</span>
    </span>
  );
}

export function Sprite({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="sprite" />;
  return <img className="sprite" src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}


/**
 * A number field you can clear and retype freely. The parent only hears about values that
 * are in range; on blur the text snaps to the clamped value (or to empty when allowed).
 */
export function NumberInput(props: {
  value: number | null;
  onChange: (v: number | null) => void;
  min: number;
  max: number;
  step?: number;
  /** When true, clearing the field reports null; otherwise it reverts to the last value. */
  allowEmpty?: boolean;
  placeholder?: string;
  'aria-label'?: string;
}) {
  const { value, onChange, min, max, step, allowEmpty, placeholder } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value == null ? '' : String(value));
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      aria-label={props['aria-label']}
      value={shown}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        if (text === '') {
          if (allowEmpty) onChange(null);
          return;
        }
        const n = Number(text);
        if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
      }}
      onBlur={() => {
        if (draft == null) return;
        setDraft(null);
        if (draft === '') {
          if (allowEmpty) onChange(null);
          return;
        }
        const n = Number(draft);
        if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
      }}
    />
  );
}
