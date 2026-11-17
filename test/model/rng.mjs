// Seeded randomness: the same seed always gives the same sequence (mulberry32).
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const r = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (xs) => xs[Math.floor(next() * xs.length)],
    chance: (p) => next() < p,
    /** Weighted pick from [[item, weight], …]. */
    weighted: (pairs) => { const tot = pairs.reduce((s, [, w]) => s + w, 0); let x = next() * tot; for (const [it, w] of pairs) { if ((x -= w) < 0) return it; } return pairs[pairs.length - 1][0]; },
    shuffle: (xs) => { const c = [...xs]; for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; } return c; },
  };
  return r;
}
