// Coverage bookkeeping: every (state, action) transition and every consecutive action pair actually executed.
export function recorder() {
  const t = {}; const p = {}; const misc = {};
  // Flat sets for coverage-guided generators: "machine|state|action" and "machine|a>b".
  const covered = { t: new Set(), p: new Set(), pressed: new Set() };
  return {
    covered,
    transition(m, from, action, to) { covered.t.add(`${m}|${from}|${action}`); ((t[m] ??= {})[`${from}|${action}`] ??= { n: 0, to: new Set() }).n++; t[m][`${from}|${action}`].to.add(to); },
    pair(m, a, b) { const k = `${a}>${b}`; covered.p.add(`${m}|${k}`); (p[m] ??= {})[k] = ((p[m] ??= {})[k] ?? 0) + 1; },
    hit(kind, key) { (misc[kind] ??= {})[key] = (misc[kind][key] ?? 0) + 1; },
    dump() { const tt = {}; for (const [m, o] of Object.entries(t)) { tt[m] = {}; for (const [k, v] of Object.entries(o)) tt[m][k] = { n: v.n, to: [...v.to] }; } return { transitions: tt, pairs: p, misc }; },
  };
}
/** Merge several dumps (from several seeds / layers). */
export function merge(dumps) {
  const out = { transitions: {}, pairs: {}, misc: {} };
  for (const d of dumps) {
    for (const [m, o] of Object.entries(d.transitions ?? {})) for (const [k, v] of Object.entries(o)) { const x = ((out.transitions[m] ??= {})[k] ??= { n: 0, to: [] }); x.n += v.n; x.to = [...new Set([...x.to, ...v.to])]; }
    for (const [m, o] of Object.entries(d.pairs ?? {})) for (const [k, v] of Object.entries(o)) (out.pairs[m] ??= {})[k] = (out.pairs[m][k] ?? 0) + v;
    for (const [m, o] of Object.entries(d.misc ?? {})) for (const [k, v] of Object.entries(o)) (out.misc[m] ??= {})[k] = (out.misc[m][k] ?? 0) + v;
  }
  return out;
}
