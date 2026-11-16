// Number and luck formatting shared by the views.

export function gp(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e8 ? 1 : 2)}M`;
  if (a >= 1e5) return `${(n / 1e3).toFixed(0)}K`;
  return Math.round(n).toLocaleString();
}

export const pct = (x: number) => `${(x * 100).toFixed(x > 0.999 || x < 0.001 ? 2 : 1)}%`;
export const oneIn = (p: number) => (p >= 1 ? 'Always' : p <= 0 ? 'Never' : `1/${(1 / p) >= 100 ? Math.round(1 / p).toLocaleString() : (1 / p).toFixed(1)}`);

export function luckWord(x: number): string {
  if (x >= 0.9) return 'very lucky';
  if (x >= 0.65) return 'lucky';
  if (x > 0.35) return 'about average';
  if (x > 0.1) return 'unlucky';
  return 'very unlucky';
}
