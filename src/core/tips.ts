import type { WidgetSession } from "./glance";

/**
 * "Tips for right now": current Claude Code best practices, shown only when the data says they apply.
 * Deterministic. Each tip carries the observation that triggered it (never a generic lecture).
 */
export type TipAction = "startFresh" | "checkpoint" | "newBuild" | "planMode" | "setupUndo" | null;
export interface Tip { key: string; text: string; why: string; action: TipAction; actionLabel?: string; cwd?: string }

export interface TipInput {
  now: number;
  builds: WidgetSession[];
  limits: { fiveHourPct: number | null; sevenDayPct: number | null; fullAt: number | null; fiveHourResetsAt: number | null };
  /** The build using the most of today's usage (when more than one build ran). */
  biggest?: { folder: string; share: number } | null;
  isGit: boolean | null;
  unsaved: number | null;
  stuck: string[];
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function tips(i: TipInput, max = 3): Tip[] {
  const out: Tip[] = [];
  const full = i.builds.filter((b) => (b.contextPct ?? 0) >= 80).sort((a, b) => (b.contextPct ?? 0) - (a.contextPct ?? 0))[0];
  if (full) out.push({ key: "memory", text: `${full.folder}'s chat is ${Math.round(full.contextPct!)}% full, so Claude will start forgetting details. Start a fresh chat that picks up where it left off.`, why: "Near full, Claude summarizes and loses details. A fresh chat with a summary keeps it sharp and uses less of your limit per message.", action: "startFresh", actionLabel: "Start fresh", cwd: full.cwd });
  if (i.stuck.length) out.push({ key: "stuck", text: "A build keeps repeating a fix that fails. Stop it and ask Claude for a plan first.", why: i.stuck[0]!, action: "planMode", actionLabel: "Write a plan prompt" });
  const soon = i.limits.fullAt != null && i.limits.fullAt - i.now < 60 * 60_000;
  if (soon || (i.limits.fiveHourPct ?? 0) >= 85) {
    const when = i.limits.fullAt ? `around ${clock(i.limits.fullAt)}` : "soon";
    const back = i.limits.fiveHourResetsAt ? ` It's back at ${clock(i.limits.fiveHourResetsAt)}.` : "";
    const big = i.biggest && i.biggest.share >= 40 ? ` ${i.biggest.folder} is using ${i.biggest.share}% today; pause it if it can wait.` : " Fresh chats and smaller asks make it last longer.";
    out.push({ key: "limit", text: `You'll hit your 5-hour limit ${when}.${back}${big}`, why: `5-hour usage is at ${Math.round(i.limits.fiveHourPct ?? 0)}%.`, action: null });
  }
  if ((i.limits.sevenDayPct ?? 0) >= 85) out.push({ key: "week", text: `You've used ${Math.round(i.limits.sevenDayPct!)}% of this week. Save it for the important work; use a lighter model (/model) for small tasks.`, why: "Weekly limits take days to reset.", action: null });
  const byFolder = new Map<string, number>();
  for (const b of i.builds) if (b.status === "running" || b.status === "awaiting_approval" || b.status === "blocked") byFolder.set(b.cwd, (byFolder.get(b.cwd) ?? 0) + 1);
  const crowded = [...byFolder.entries()].find(([, n]) => n >= 2);
  if (crowded) out.push({ key: "overlap", text: `${crowded[1]} builds are changing the same folder and can undo each other's work. Move one to its own copy.`, why: crowded[0], action: "newBuild", actionLabel: "New build" });
  if (i.isGit === false) out.push({ key: "nogit", text: "This project has no undo yet. If Claude breaks something, you can't go back.", why: "Without Git you can't roll back a bad AI change.", action: "setupUndo", actionLabel: "Turn on undo" });
  else if ((i.unsaved ?? 0) >= 15) out.push({ key: "unsaved", text: `${i.unsaved} changed files aren't saved yet. Make a save point before the next big change.`, why: "A save point lets you undo the next AI edit if it goes wrong.", action: "checkpoint", actionLabel: "Make save point" });
  return out.slice(0, max);
}
