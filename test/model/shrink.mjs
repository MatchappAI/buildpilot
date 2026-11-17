// Delta debugging (ddmin): the smallest sub-sequence of a failing action sequence that still fails the same way.
// `fails(seq)` replays a candidate on a fresh world and returns true when it reproduces. Budget = max replays.
export async function shrink(seq, fails, { budget = 60, log = () => {} } = {}) {
  let cur = seq; let n = 2; let runs = 0;
  while (cur.length >= 2 && runs < budget) {
    const size = Math.ceil(cur.length / n); let reduced = false;
    for (let i = 0; i < n && runs < budget; i++) {
      const complement = [...cur.slice(0, i * size), ...cur.slice((i + 1) * size)];
      if (!complement.length) continue;
      runs++;
      if (await fails(complement)) { cur = complement; n = Math.max(n - 1, 2); reduced = true; log(`shrunk to ${cur.length} (replay ${runs})`); break; }
    }
    if (!reduced) { if (n >= cur.length) break; n = Math.min(cur.length, n * 2); }
  }
  // last pass: drop single steps
  for (let i = cur.length - 1; i >= 0 && runs < budget && cur.length > 1; i--) { const c = [...cur.slice(0, i), ...cur.slice(i + 1)]; runs++; if (await fails(c)) cur = c; }
  return { seq: cur, runs };
}
/** Same failure = same first error, with numbers, ids and paths blurred. */
export const signature = (f) => String(f?.errors?.[0] ?? "").replace(/\/[^\s"']+/g, "<path>").replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "<id>").replace(/\d+/g, "N").slice(0, 120);
