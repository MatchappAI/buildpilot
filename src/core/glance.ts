import * as os from "os";
import * as path from "path";
import { Engine, realpath } from "./engine";
import { readLiveStatus } from "./hooks";
import { rowToSession } from "./ingest";
import { deriveDisplayStatus } from "./supervisor";
import { SessionStatus } from "./types";

/**
 * Terminal "glance": what BuildPilot prints when a terminal opens.
 * Accessible by design: every state is a WORD (never color alone), color only when the terminal supports it
 * (respects NO_COLOR / non-TTY), one idea per line, fits the terminal width, at most ~7 lines.
 */

export interface GlanceOptions {
  cwd: string;
  columns: number;
  color: boolean;
  now?: number;
}

const WORD: Record<SessionStatus, string> = {
  running: "working",
  idle: "idle",
  blocked: "needs input",
  awaiting_approval: "needs approval",
  completed: "ended",
  failed: "failed",
  unknown: "no recent activity",
};
const MARK: Record<SessionStatus, string> = { running: "●", idle: "○", blocked: "!", awaiting_approval: "!", completed: "·", failed: "✗", unknown: "?" };

export interface WidgetSession {
  id: string;
  folder: string;
  cwd: string;
  status: SessionStatus;
  word: string;
  reason: string;
  task: string | null;
  contextPct: number | null;
  lastEventAt: number;
  needsYou: boolean;
  next: string | null;
}
export interface WidgetData {
  v: 1;
  generatedAt: number;
  sessions: WidgetSession[];
  needs: number;
  working: number;
  fiveHourPct: number | null;
  sevenDayPct: number | null;
}

/** Active Claude Code sessions across all folders, needs-you first. Shared by the terminal glance and the menu-bar widget. */
export function glanceItems(engine: Engine, now: number) {
  const rows = engine.store
    .all<Record<string, unknown>>("SELECT * FROM sessions WHERE ended_at IS NULL AND last_event_at > ? AND id NOT LIKE 'demo-%' ORDER BY last_event_at DESC LIMIT 12", [now - 3 * 3600_000])
    .map(rowToSession);
  const items = rows
    .map((s) => {
      const d = deriveDisplayStatus(s, now);
      return { s, status: d.status, reason: d.reason, live: readLiveStatus(s.id, engine.home) };
    })
    .filter((x) => x.status !== "unknown" || now - x.s.lastEventAt < 3600_000);
  const isNeed = (st: SessionStatus) => st === "awaiting_approval" || st === "blocked" || st === "failed";
  const needs = items.filter((x) => isNeed(x.status));
  return { items: [...needs, ...items.filter((x) => !isNeed(x.status))], needs, isNeed };
}

function projectNext(engine: Engine, cwd: string): string | null {
  const pid = engine.resolveProject(realpath(cwd));
  if (!pid) return null;
  try {
    const sum = JSON.parse(String(engine.store.scalar("SELECT value FROM notes WHERE project_id = ? AND key = 'summary'", [pid]) ?? "")) as { next: string | null };
    return sum.next ?? null;
  } catch {
    return null;
  }
}

/** A readable name for where a build runs. Chats started in the home folder aren't a project. */
export function folderLabel(cwd: string, home = os.homedir()): string {
  if (path.resolve(cwd) === path.resolve(home)) return "Home folder";
  return path.basename(cwd) || cwd;
}

/** One readable line from a task/prompt: first line, collapsed spaces, clipped. */
export function oneLine(text: string | null, max = 90): string | null {
  if (!text) return null;
  const t = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  const c = t.replace(/\s+/g, " ");
  return c.length > max ? `${c.slice(0, max - 1).trimEnd()}…` : c;
}

export function widgetData(engine: Engine, now = Date.now()): WidgetData {
  const { items, needs, isNeed } = glanceItems(engine, now);
  const pick = (k: "fiveHourPct" | "sevenDayPct") => {
    const v = items.map((x) => x.live?.[k]).filter((n): n is number => typeof n === "number");
    return v.length ? Math.max(...v) : null;
  };
  return {
    v: 1,
    generatedAt: now,
    sessions: items.map((x) => ({
      id: x.s.id,
      folder: folderLabel(x.s.cwd),
      cwd: x.s.cwd,
      status: x.status,
      word: WORD[x.status],
      reason: x.reason.split("\n")[0]!.replace(/\s+/g, " ").slice(0, 160),
      task: x.s.currentTask ? x.s.currentTask.replace(/\s+/g, " ").slice(0, 160) : null,
      contextPct: x.live?.contextPct ?? null,
      lastEventAt: x.s.lastEventAt,
      needsYou: isNeed(x.status),
      next: projectNext(engine, x.s.cwd),
    })),
    needs: needs.length,
    working: items.filter((x) => x.status === "running").length,
    fiveHourPct: pick("fiveHourPct"),
    sevenDayPct: pick("sevenDayPct"),
  };
}

export function glance(engine: Engine, o: GlanceOptions): string {
  const now = o.now ?? Date.now();
  const c = (code: string, s: string) => (o.color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const bold = (s: string) => c("1", s);
  const dim = (s: string) => c("2", s);
  const tone = (st: SessionStatus, s: string) => (st === "awaiting_approval" || st === "blocked" ? c("33", s) : st === "failed" ? c("31", s) : st === "running" ? c("32", s) : s);
  const W = Math.max(40, Math.min(o.columns || 80, 120));
  const fit = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(0, n - 1)) + "…" : s.padEnd(n));

  const { items, needs } = glanceItems(engine, now);
  const limits = items.map((x) => x.live?.fiveHourPct).filter((v): v is number => typeof v === "number");
  const fiveH = limits.length ? Math.max(...limits) : null;

  const lines: string[] = [];
  const head = [
    bold("◆ BuildPilot"),
    items.length ? `${items.length} Claude session${items.length === 1 ? "" : "s"}` : "no active Claude sessions",
    needs.length ? c("33", `${needs.length} need${needs.length === 1 ? "s" : ""} you`) : null,
    fiveH != null ? `5-hour limit ${Math.round(fiveH)}%` : null,
  ].filter(Boolean);
  lines.push(head.join(dim("  ·  ")));

  // Waiting sessions first, then the rest; at most 5 rows.
  const ordered = [...needs, ...items.filter((x) => !needs.includes(x))].slice(0, 5);
  const nameW = Math.min(18, Math.max(8, ...ordered.map((x) => (path.basename(x.s.cwd) || "?").length)));
  for (const x of ordered) {
    const name = fit(path.basename(x.s.cwd) || "?", nameW);
    const ctx = x.live?.contextPct != null ? `context ${Math.round(x.live.contextPct)}%` : "";
    const what =
      x.status === "awaiting_approval" || x.status === "blocked" || x.status === "failed"
        ? x.reason
        : x.s.currentTask
          ? `"${x.s.currentTask.replace(/\s+/g, " ")}"`
          : x.reason;
    const what1 = what.replace(/\s+/g, " ").trim();
    const word = WORD[x.status].padEnd(14);
    const left = `  ${MARK[x.status]} ${name}  ${word}`;
    const room = W - left.length - (ctx ? ctx.length + 3 : 0) - 3;
    const middle = room > 8 ? `  ${fit(what1, room)}` : "";
    lines.push(`${tone(x.status, `  ${MARK[x.status]} `)}${name}  ${tone(x.status, word)}${dim(middle.replace(/^ {2}/, ""))}${ctx ? `  ${ctx}` : ""}`);
  }
  if (items.length > ordered.length) lines.push(dim(`    +${items.length - ordered.length} more`));

  // This folder's saved next step (computed by BuildPilot in VS Code; the terminal never runs a slow analysis).
  const pid = engine.resolveProject(realpath(o.cwd));
  if (pid) {
    const raw = engine.store.scalar("SELECT value FROM notes WHERE project_id = ? AND key = 'summary'", [pid]);
    try {
      const sum = JSON.parse(String(raw ?? "")) as { next: string | null; health: string; name: string };
      const msg = sum.next ? `Next: ${sum.next}` : sum.health;
      lines.push(`  ${bold("Here")} ${dim(fit(sum.name, 24).trim())}  ${fit(msg.replace(/\s+/g, " "), W - 34).trimEnd()}`);
    } catch {
      /* not analyzed yet */
    }
  }
  lines.push(dim(`  bp = details · bp open = BuildPilot in VS Code · bp prompt <goal> "<what you want>"`));
  return lines.join("\n");
}
