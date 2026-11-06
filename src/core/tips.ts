import type { WidgetSession } from "./glance";

/**
 * "Tips for right now": current Claude Code best practices, shown only when the data says they apply.
 * Deterministic. Each tip carries the observation that triggered it (never a generic lecture).
 */
export type TipAction = "handoff" | "checkpoint" | "newBuild" | "planMode" | null;
export interface Tip { key: string; text: string; why: string; action: TipAction; actionLabel?: string }

export interface TipInput {
  now: number;
  builds: WidgetSession[];
  limits: { fiveHourPct: number | null; sevenDayPct: number | null; fullAt: number | null; fiveHourResetsAt: number | null };
  isGit: boolean | null;
  unsaved: number | null;
  stuck: string[];
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function tips(i: TipInput, max = 3): Tip[] {
  const out: Tip[] = [];
  const full = i.builds.filter((b) => (b.contextPct ?? 0) >= 80).sort((a, b) => (b.contextPct ?? 0) - (a.contextPct ?? 0))[0];
  if (full) out.push({ key: "memory", text: `${full.folder}'s memory is ${Math.round(full.contextPct!)}% full. Start a fresh build and paste the handoff.`, why: "Near full, Claude starts summarizing and forgets details. A fresh session with a handoff keeps it sharp.", action: "handoff", actionLabel: "Copy handoff" });
  if (i.stuck.length) out.push({ key: "stuck", text: "A build is repeating the same failing fix. Stop it and ask for a plan first.", why: i.stuck[0]!, action: "planMode", actionLabel: "Write a plan prompt" });
  const soon = i.limits.fullAt != null && i.limits.fullAt - i.now < 60 * 60_000;
  if (soon || (i.limits.fiveHourPct ?? 0) >= 85) {
    const when = i.limits.fullAt ? `around ${clock(i.limits.fullAt)}` : "soon";
    const reset = i.limits.fiveHourResetsAt ? ` It resets at ${clock(i.limits.fiveHourResetsAt)}.` : "";
    out.push({ key: "limit", text: `You'll hit your 5-hour limit ${when}. Finish the most important task first.${reset}`, why: `5-hour usage is at ${Math.round(i.limits.fiveHourPct ?? 0)}%.`, action: null });
  }
  if ((i.limits.sevenDayPct ?? 0) >= 85) out.push({ key: "week", text: `You've used ${Math.round(i.limits.sevenDayPct!)}% of this week. Use a lighter model for small tasks.`, why: "Weekly limits take days to reset.", action: null });
  const byFolder = new Map<string, number>();
  for (const b of i.builds) if (b.status === "running" || b.status === "awaiting_approval" || b.status === "blocked") byFolder.set(b.cwd, (byFolder.get(b.cwd) ?? 0) + 1);
  const crowded = [...byFolder.entries()].find(([, n]) => n >= 2);
  if (crowded) out.push({ key: "overlap", text: `${crowded[1]} builds are editing the same folder. Give one its own copy so they don't clash.`, why: crowded[0], action: "newBuild", actionLabel: "New build" });
  if (i.isGit === false) out.push({ key: "nogit", text: "This project has no undo yet. Ask Claude: \"set up git and make a first commit\".", why: "Without Git you can't roll back a bad AI change.", action: null });
  else if ((i.unsaved ?? 0) >= 15) out.push({ key: "unsaved", text: `${i.unsaved} changed files aren't saved. Make a save point before the next big change.`, why: "A save point lets you undo the next AI edit if it goes wrong.", action: "checkpoint", actionLabel: "Make save point" });
  return out.slice(0, max);
}
