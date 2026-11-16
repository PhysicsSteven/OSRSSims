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

