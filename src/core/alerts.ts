import type { PageData } from "./page";

/**
 * Which notifications to send now, each at most once. Pure: give it the page data and a memory object.
 * The first call only records the current state (no flood of old alerts when the app opens).
 */
export interface AlertMemory { sent: Record<string, number>; seeded?: boolean }
export interface Alert { key: string; title: string; body: string }

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function alertsFor(p: PageData, mem: AlertMemory, now: number): Alert[] {
  const cand: Alert[] = [];
  for (const b of p.builds) {
    const who = b.name ?? b.folder;
    if (b.needsYou) cand.push({ key: `need:${b.id}:${b.lastEventAt}`, title: `${who} needs you`, body: b.waitingFor ? `Waiting for your OK: ${b.waitingFor}` : b.reason || "Claude is waiting for your answer." });
    if ((b.errors1h ?? 0) >= 3) cand.push({ key: `err:${b.id}:${Math.floor(now / (30 * 60_000))}`, title: `${who}: ${b.errors1h} errors in the last hour`, body: (b.lastErrors ?? [])[0] ?? "Check it before it burns more of your limit." });
    if (b.compactedAt && now - b.compactedAt < 10 * 60_000) cand.push({ key: `compact:${b.id}:${b.compactedAt}`, title: `${who} compacted its memory`, body: "It may have forgotten your rules. Consider a fresh chat with a summary." });
    // "Your turn": a long turn (3+ min) just finished, so you're not left waiting on a build that's done.
    if (b.finishedAt && b.turnMs && b.turnMs >= 3 * 60_000 && now - b.finishedAt < 3 * 60_000) cand.push({ key: `fin:${b.id}:${b.finishedAt}`, title: `${who} finished`, body: `Done after ${Math.round(b.turnMs / 60_000)} min. Your turn.` });
    if (b.stopped) cand.push({ key: `stop:${b.id}:${b.lastEventAt}`, title: `${who} stopped mid-task`, body: "Its last request never finished. Resume it from BuildPilot." });
  }
  const L = p.limits;
  const win = String(L.fiveHourResetsAt ?? "x");
  if ((L.fiveHourPct ?? 0) >= 80) cand.push({ key: `80:${win}`, title: `${Math.round(L.fiveHourPct!)}% of your 5-hour Claude limit used`, body: `${L.fullAt ? `At this pace it runs out around ${clock(L.fullAt)}. ` : ""}${L.fiveHourResetsAt ? `Back at ${clock(L.fiveHourResetsAt)}.` : ""}`.trim() || "Save it for the important work." });
  if (L.fullAt && L.fullAt - now < 30 * 60_000) cand.push({ key: `30:${win}`, title: "About 30 minutes of Claude left", body: `Runs out around ${clock(L.fullAt)}${L.fiveHourResetsAt ? `, back at ${clock(L.fiveHourResetsAt)}` : ""}.` });
  const fresh = cand.filter((a) => !(a.key in mem.sent));
  for (const a of fresh) mem.sent[a.key] = now;
  // Forget old keys (keeps memory small).
  for (const [k, t] of Object.entries(mem.sent)) if (now - t > 24 * 3600_000) delete mem.sent[k];
  if (!mem.seeded) {
    mem.seeded = true;
    return [];
  }
  return fresh;
}
