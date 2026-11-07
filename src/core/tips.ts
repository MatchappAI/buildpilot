import * as os from "os";
import * as path from "path";
import type { WidgetSession } from "./glance";

/**
 * "Tips for right now": current Claude Code best practices, shown only when the data says they apply.
 * Deterministic. Each tip carries the observation that triggered it (never a generic lecture).
 */
export type TipAction = "startFresh" | "checkpoint" | "newBuild" | "planMode" | "setupUndo" | "pause" | "resumeBuild" | null;
export interface Tip { key: string; text: string; why: string; action: TipAction; actionLabel?: string; cwd?: string; id?: string }

export interface TipInput {
  now: number;
  builds: WidgetSession[];
  limits: { fiveHourPct: number | null; sevenDayPct: number | null; fullAt: number | null; fiveHourResetsAt: number | null };
  /** The build using the most of today's usage (when more than one build ran). */
  biggest?: { folder: string; share: number; cwd?: string } | null;
  isGit: boolean | null;
  unsaved: number | null;
  stuck: string[];
  /** When the weekly limit runs out at the current pace (if before the reset). */
  weekFullAt?: number | null;
  /** Approximate tokens in the project's CLAUDE.md files. */
  claudeMdTokens?: number | null;
}

type TokenBuild = WidgetSession & { tokens?: { baseline: number | null; models: [string, number][]; subagents: number; top: { label: string; tokens: number }[] | null; turns: number } | null };
const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function tips(i: TipInput, max = 3): Tip[] {
  const out: Tip[] = [];
  const full = i.builds.filter((b) => (b.contextPct ?? 0) >= 80).sort((a, b) => (b.contextPct ?? 0) - (a.contextPct ?? 0))[0];
  if (full) out.push({ key: "memory", text: `${full.folder}'s chat is ${Math.round(full.contextPct!)}% full, so Claude will start forgetting details. Start a fresh chat that picks up where it left off.`, why: "Near full, Claude summarizes and loses details. A fresh chat with a summary keeps it sharp and uses less of your limit per message.", action: "startFresh", actionLabel: "Start fresh chat", cwd: full.cwd });
  if (i.stuck.length) out.push({ key: "stuck", text: "A build keeps repeating a fix that fails. Stop it and ask Claude for a plan first.", why: i.stuck[0]!, action: "planMode", actionLabel: "Write a plan prompt" });
  const soon = i.limits.fullAt != null && i.limits.fullAt - i.now < 60 * 60_000;
  if (soon || (i.limits.fiveHourPct ?? 0) >= 85) {
    // The limits card already shows the run-out time; the tip says what to do about it.
    const head = `You've used ${Math.round(i.limits.fiveHourPct ?? 0)}% of your 5-hour limit${i.limits.fiveHourResetsAt ? ` (back at ${clock(i.limits.fiveHourResetsAt)})` : ""}.`;
    const pausable = i.biggest && i.biggest.share >= 40 && i.builds.length > 1;
    const big = pausable ? ` ${i.biggest!.folder} is using ${i.biggest!.share}% of your usage today; pause it if it can wait (press Esc in its terminal; your files are kept).` : " A fresh chat for each small task uses less per message.";
    out.push({ key: "limit", text: `${head}${big}`, why: `5-hour usage is at ${Math.round(i.limits.fiveHourPct ?? 0)}%.`, action: pausable ? "pause" : null, actionLabel: pausable ? `Open ${i.biggest!.folder}` : undefined, cwd: pausable ? i.biggest!.cwd : undefined });
  }
  if ((i.limits.sevenDayPct ?? 0) >= 85) out.push({ key: "week", text: `You've used ${Math.round(i.limits.sevenDayPct!)}% of this week. Save it for the important work; use a lighter model (/model) for small tasks.`, why: "Weekly limits take days to reset.", action: null });
  const byFolder = new Map<string, number>();
  // Chats in the home folder usually aren't editing one project, so they don't count as overlapping.
  for (const b of i.builds) if ((b.status === "running" || b.status === "awaiting_approval" || b.status === "blocked") && path.resolve(b.cwd) !== path.resolve(os.homedir())) byFolder.set(b.cwd, (byFolder.get(b.cwd) ?? 0) + 1);
  const crowded = [...byFolder.entries()].find(([, n]) => n >= 2);
  if (crowded) out.push({ key: "overlap", text: `${crowded[1]} builds are changing the same folder and can undo each other's work. Move one to its own copy.`, why: crowded[0], action: "newBuild", actionLabel: "New build" });
  if (i.isGit === false) out.push({ key: "nogit", text: "This project has no undo yet. If Claude breaks something, you can't go back.", why: "Without Git you can't roll back a bad AI change.", action: "setupUndo", actionLabel: "Turn on undo" });
  else if ((i.unsaved ?? 0) >= 15) out.push({ key: "unsaved", text: `${i.unsaved} changed files aren't saved yet. Make a save point before the next big change.`, why: "A save point lets you undo the next AI edit if it goes wrong.", action: "checkpoint", actionLabel: "Make save point" });
  // ---- power-user tips from live activity and transcripts (evidence-based) ----
  for (const b of i.builds as TokenBuild[]) {
    if (b.compactedAt && i.now - b.compactedAt < 30 * 60_000) out.push({ key: `compact:${b.id}`, text: `${b.name ?? b.folder} just compacted its memory, so it may have forgotten your rules and decisions. Start a fresh chat with a summary.`, why: "Compaction summarizes the chat to free space; details get lost.", action: "startFresh", actionLabel: "Start fresh chat", cwd: b.cwd });
    if ((b.errors1h ?? 0) >= 3) out.push({ key: `errors:${b.id}`, text: `${b.name ?? b.folder} hit ${b.errors1h} errors in the last hour. Check them before it burns more of your limit.`, why: (b.lastErrors ?? [])[0] ?? "", action: null });
    if (b.stopped) out.push({ key: `stopped:${b.id}`, text: `${b.name ?? b.folder} stopped in the middle of a task.`, why: "Its last request never finished.", action: "resumeBuild", actionLabel: "Resume", cwd: b.cwd, id: b.id });
    const t = b.tokens;
    if (t?.top?.[0] && t.top[0].tokens >= 15_000 && /^(Read|Bash|Grep|Glob|WebFetch)/.test(t.top[0].label)) out.push({ key: `hog:${b.id}`, text: `In ${b.name ?? b.folder}, "${t.top[0].label}" pulled about ${k(t.top[0].tokens)} tokens into the chat. Ask Claude to read only the part it needs, or ignore that file.`, why: "Big tool output stays in the chat and is re-sent on every message.", action: null });
    if (t && t.subagents >= 3) out.push({ key: `subagents:${b.id}`, text: `${b.name ?? b.folder} used ${t.subagents} subagents. Each one uses its own tokens, so usage multiplies.`, why: "Subagents are great for parallel research but costly for small tasks.", action: null });
  }
  const heavy = (i.builds as TokenBuild[]).find((b) => (b.tokens?.baseline ?? 0) >= 25_000);
  if (heavy) out.push({ key: "baseline", text: `Every new chat starts with about ${k(heavy.tokens!.baseline!)} tokens before you type (tool and MCP setup${(i.claudeMdTokens ?? 0) >= 2000 ? ` + CLAUDE.md ≈${k(i.claudeMdTokens!)}` : ""}). Turn off MCP servers you don't use (/mcp).`, why: "That starting load is sent with every message and fills the chat faster.", action: null });
  else if ((i.claudeMdTokens ?? 0) >= 8000) out.push({ key: "claudemd", text: `Your CLAUDE.md is about ${k(i.claudeMdTokens!)} tokens and is sent with every message. Trim it to the rules that matter.`, why: "Shorter project rules = more room for real work.", action: null });
  // (Weekly pace is shown in the limits card, so no duplicate tip.)
  // Most urgent first; one tip per kind.
  const ORDER = ["limit", "stopped", "errors", "compact", "memory", "stuck", "overlap", "hog", "week", "weekpace", "baseline", "subagents", "claudemd", "nogit", "unsaved"];
  const rank = (t: Tip) => { const i2 = ORDER.indexOf(t.key.split(":")[0]!); return i2 < 0 ? 99 : i2; };
  const seenKind = new Set<string>();
  return out.sort((a, b) => rank(a) - rank(b)).filter((t) => { const kk = t.key.split(":")[0]!; if (seenKind.has(kk)) return false; seenKind.add(kk); return true; }).slice(0, max);
}
