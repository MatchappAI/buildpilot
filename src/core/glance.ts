import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Engine, realpath } from "./engine";
import { readLiveStatus } from "./hooks";
import { rowToEvent, rowToSession } from "./ingest";
import { Activity, activityFor, risksIn, TimelineItem, turnSummary } from "./activity";
import { deriveDisplayStatus } from "./supervisor";
import { Checklist, SessionStatus } from "./types";

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
  // One vocabulary in the window, terminal and menu bar.
  running: "working",
  idle: "your turn",
  blocked: "needs your answer",
  awaiting_approval: "needs your OK",
  completed: "closed",
  failed: "failed",
  unknown: "quiet",
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
  /** Your name for this build (set on the page), else null. */
  name?: string | null;
  /** Live detail from hook events (see activity.ts). */
  now?: string | null;
  nowSince?: number | null;
  errors1h?: number;
  lastErrors?: string[];
  waitingFor?: string | null;
  stopped?: boolean;
  autoApprove?: boolean;
  compactedAt?: number | null;
  timeline?: TimelineItem[];
  retries1h?: number;
  finishedAt?: number | null;
  turnMs?: number | null;
  maybeStuck?: boolean;
  nowFull?: string | null;
  /** Latest request: steps, files changed, proof (verified / failing / unverified). Observed only. */
  turn?: Activity["turn"];
  /** Risky things it did recently, in plain words. */
  risks?: string[];
  /** Claude's own checklist when it keeps one (TodoWrite / task tools): done of total, and the current item. */
  checklist?: Checklist | null;
  /** Extra words to tell apart builds that would otherwise have the same name. */
  hint?: string | null;
  /** "claude" (default) or "codex" (read-only, from ~/.codex logs). */
  agent?: "claude" | "codex";
}
export interface WidgetData {
  v: 1;
  generatedAt: number;
  sessions: WidgetSession[];
  needs: number;
  working: number;
  /** Finished in the last 2 hours and waiting for your next message. */
  yourTurn?: number;
  fiveHourPct: number | null;
  sevenDayPct: number | null;
}

/** One rule everywhere: it answered and is waiting for your next message (finished in the last 2 hours). */
export function isYourTurn(status: SessionStatus, finishedAt: number | null | undefined, now: number): boolean {
  return status === "idle" && !!finishedAt && now - finishedAt < 2 * 3600_000;
}

/** Active Claude Code sessions across all folders, needs-you first. Shared by the terminal glance and the menu-bar widget. */
export function glanceItems(engine: Engine, now: number) {
  // Open sessions from the last 12 h (quiet ones collapse on the page), plus ones that ended mid-task in the last 3 h.
  const rows = engine.store
    .all<Record<string, unknown>>("SELECT * FROM sessions WHERE id NOT LIKE 'demo-%' AND ((ended_at IS NULL AND last_event_at > ?) OR (ended_at IS NOT NULL AND ended_at > ?)) ORDER BY last_event_at DESC LIMIT 60", [now - 12 * 3600_000, now - 3 * 3600_000])
    .map(rowToSession);
  const items = rows
    .map((s) => {
      const d = deriveDisplayStatus(s, now);
      const events = engine.store.all<Record<string, unknown>>("SELECT * FROM events WHERE session_id = ? ORDER BY ts DESC, id DESC LIMIT 80", [s.id]).map(rowToEvent);
      const act = activityFor(s, events, now);
      // The last 80 events may not reach back to the start of a long request: summarize it from its own events.
      const lastAsk = engine.store.get<{ ts: number }>("SELECT MAX(ts) AS ts FROM events WHERE session_id = ? AND hook_event = 'UserPromptSubmit' AND summary NOT LIKE 'Prompt: [Subagent hand-back]%' AND summary NOT IN ('Prompt: Message from another Claude session','Prompt: Background task update','Prompt: System update','Prompt: Report from a helper')", [s.id]);
      if (lastAsk?.ts != null) {
        const turnEv = engine.store.all<Record<string, unknown>>("SELECT * FROM events WHERE session_id = ? AND ts >= ? AND (hook_event IN ('UserPromptSubmit','Stop','PostToolUse','PostToolUseFailure')) ORDER BY ts, id LIMIT 3000", [s.id, Number(lastAsk.ts)]).map(rowToEvent);
        act.turn = turnSummary(turnEv);
      }
      const riskEv = engine.store.all<Record<string, unknown>>("SELECT * FROM events WHERE session_id = ? AND ts > ? AND hook_event IN ('PostToolUse','PostToolUseFailure') AND tool_name IN ('Bash','Edit','Write','MultiEdit','NotebookEdit') ORDER BY ts, id LIMIT 2000", [s.id, now - 3 * 3600_000]).map(rowToEvent);
      // "Looks fine" hides a session's current warnings until a new one appears.
      const ok = new Set(String(engine.store.scalar("SELECT value FROM notes WHERE project_id = ? AND key = ?", [NAMES_SCOPE, `risk-ok:${s.id}`]) ?? "").split("\n").filter(Boolean));
      act.risks = risksIn(riskEv).filter((r) => !ok.has(r));
      return { s, status: d.status, reason: d.reason, live: readLiveStatus(s.id, engine.home), act };
    })
    .filter((x) => (!x.s.endedAt || x.act.stopped) && !isBackground(x.s.cwd))
    .filter((x) => x.status !== "unknown" || now - x.s.lastEventAt < 3600_000);
  const isNeed = (st: SessionStatus) => st === "awaiting_approval" || st === "blocked" || st === "failed";
  const needs = items.filter((x) => isNeed(x.status));
  return { items: [...needs, ...items.filter((x) => !isNeed(x.status))], needs, isNeed };
}

function projectNext(engine: Engine, cwd: string): string | null {
  const pid = engine.resolveProject(realpath(cwd));
  if (!pid) return null;
  try {
    const sum = JSON.parse(String(engine.store.scalar("SELECT value FROM notes WHERE project_id = ? AND key = 'summary'", [pid]) ?? "")) as { next: string | null; severity?: string | null };
    // Housekeeping ("write down what done means", "add a CLAUDE.md") is never the next step next to live work.
    return sum.severity === "low" || sum.severity === "info" ? null : sum.next ?? null;
  } catch {
    return null;
  }
}

/** Headless/background runs (temp folders: scripts, CI, agent sandboxes) aren't builds you're watching. */
export function isBackground(cwd: string): boolean {
  const p = path.resolve(cwd);
  return p.startsWith("/private/tmp/") || p.startsWith("/tmp/") || p.startsWith("/private/var/folders/") || p.startsWith("/var/folders/") || p.startsWith(path.resolve(os.tmpdir()) + path.sep);
}

/** A readable name for where a build runs. Chats started in the home folder aren't a project. */
const rootCache = new Map<string, string | null>();
export function folderLabel(cwd: string, home = os.homedir()): string {
  const abs = path.resolve(cwd);
  if (abs === path.resolve(home)) return "Home folder";
  // Inside a project's subfolder (e.g. src/): name the project, not the subfolder.
  if (!rootCache.has(abs)) {
    let root: string | null = null;
    for (let d = abs; d !== path.dirname(d) && d !== path.resolve(home); d = path.dirname(d)) if (fs.existsSync(path.join(d, ".git"))) { root = d; break; }
    rootCache.set(abs, root);
  }
  const root = rootCache.get(abs);
  return root ? path.basename(root) : path.basename(abs) || abs;
}

/** One readable line from a task/prompt: first line, collapsed spaces, clipped. */
export function oneLine(text: string | null, max = 90): string | null {
  if (!text) return null;
  const t = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  const c = t.replace(/\s+/g, " ");
  return c.length > max ? `${c.slice(0, max - 1).trimEnd()}…` : c;
}

/** A few words that tell two same-named builds apart: what you asked it to do, or its id. */
function disambiguate(b: { task: string | null; id: string; cwd?: string }): string {
  try {
    const head = fs.readFileSync(path.join(b.cwd ?? "", ".git", "HEAD"), "utf8").trim();
    const br = head.startsWith("ref: refs/heads/") ? head.slice(16) : null;
    if (br && br !== "main" && br !== "master") return br.replace(/^bp\//, "");
  } catch { /* not a repo root or a worktree (.git file): fall back to the prompt */ }
  const words = (b.task ?? "").replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter((w) => w.length > 2).slice(0, 4).join(" ");
  return words || b.id.slice(0, 6);
}

/** Names you give builds live in notes under a global key (not tied to one project). */
export const NAMES_SCOPE = "__names";

/** Mark a session's current warnings as seen ("Looks fine"). New, different warnings still show. */
export function dismissRisks(engine: Engine, sessionId: string, risks: string[]): void {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(sessionId)) return;
  const prev = String(engine.store.scalar("SELECT value FROM notes WHERE project_id = ? AND key = ?", [NAMES_SCOPE, `risk-ok:${sessionId}`]) ?? "").split("\n").filter(Boolean);
  const all = [...new Set([...prev, ...risks])].slice(-30).join("\n");
  engine.store.run("INSERT INTO notes (project_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [NAMES_SCOPE, `risk-ok:${sessionId}`, all, Date.now()]);
}
export function buildName(engine: Engine, sessionId: string): string | null {
  const v = engine.store.scalar("SELECT value FROM notes WHERE project_id = ? AND key = ?", [NAMES_SCOPE, `name:${sessionId}`]);
  return typeof v === "string" && v ? v : null;
}
export function setBuildName(engine: Engine, sessionId: string, name: string): void {
  const n = name.replace(/\s+/g, " ").trim().slice(0, 40);
  if (!n) engine.store.run("DELETE FROM notes WHERE project_id = ? AND key = ?", [NAMES_SCOPE, `name:${sessionId}`]);
  else engine.store.run("INSERT INTO notes (project_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [NAMES_SCOPE, `name:${sessionId}`, n, Date.now()]);
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
      name: buildName(engine, x.s.id),
      now: x.act.now,
      nowSince: x.act.nowSince,
      errors1h: x.act.errors1h,
      lastErrors: x.act.lastErrors,
      waitingFor: x.act.waitingFor,
      stopped: x.act.stopped,
      autoApprove: x.act.autoApprove,
      compactedAt: x.act.compactedAt,
      timeline: x.act.timeline,
      retries1h: x.act.retries1h,
      finishedAt: x.act.finishedAt,
      turnMs: x.act.turnMs,
      maybeStuck: x.act.maybeStuck,
      nowFull: x.act.nowFull,
      turn: x.act.turn,
      risks: x.act.risks,
      checklist: x.s.checklist ?? null,
      agent: "claude" as const,
    })).map((b, _i, all) => ({ ...b, hint: all.filter((o) => (o.name ?? o.folder) === (b.name ?? b.folder)).length > 1 ? disambiguate(b) : null })),
    needs: needs.length,
    working: items.filter((x) => x.status === "running").length,
    yourTurn: items.filter((x) => isYourTurn(x.status, x.act.finishedAt, now)).length,
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
    (() => { const n = items.filter((x) => isYourTurn(x.status, x.act.finishedAt, now)).length; return n ? `${n} your turn` : null; })(),
    fiveH != null ? `5-hour limit ${Math.round(fiveH)}%` : null,
  ].filter(Boolean);
  lines.push(head.join(dim("  ·  ")));

  // Waiting sessions first, then the rest; at most 5 rows.
  const ordered = [...needs, ...items.filter((x) => !needs.includes(x))].slice(0, 5);
  const nameW = Math.min(18, Math.max(8, ...ordered.map((x) => folderLabel(x.s.cwd).length)));
  for (const x of ordered) {
    const name = fit(folderLabel(x.s.cwd), nameW);
    const ctx = x.live?.contextPct != null ? `chat ${Math.round(x.live.contextPct)}% full` : "";
    const what =
      x.status === "awaiting_approval" || x.status === "blocked" || x.status === "failed"
        ? x.reason
        : x.s.currentTask
          ? `"${x.s.currentTask.replace(/\s+/g, " ")}"`
          : x.status === "idle" ? "finished" : x.reason;
    const what1 = what.replace(/\s+/g, " ").trim();
    const word = WORD[x.status].padEnd(17);
    const left = `  ${MARK[x.status]} ${name}  ${word}`;
    const room = W - left.length - (ctx ? ctx.length + 3 : 0) - 3;
    const middle = room > 8 ? `  ${fit(what1, room)}` : "";
    lines.push(`${tone(x.status, `  ${MARK[x.status]} `)}${name}  ${tone(x.status, word)}${dim(middle.replace(/^ {2}/, ""))}${ctx ? `  ${ctx}` : ""}`);
  }
  if (items.length > ordered.length) lines.push(dim(`    +${items.length - ordered.length} more`));
  // One line for anything risky it did recently (destructive command, secrets file, test edited while failing).
  const risky = ordered.map((x) => ({ x, r: x.act.risks[0] })).find((v) => v.r);
  if (risky) lines.push(c("33", `  ⚠ ${folderLabel(risky.x.s.cwd)}: ${fit(risky.r!, W - 8 - folderLabel(risky.x.s.cwd).length).trimEnd()}`));

  // This folder's saved next step (computed by BuildPilot in VS Code; the terminal never runs a slow analysis).
  const pid = engine.resolveProject(realpath(o.cwd));
  if (pid) {
    const raw = engine.store.scalar("SELECT value FROM notes WHERE project_id = ? AND key = 'summary'", [pid]);
    try {
      const sum = JSON.parse(String(raw ?? "")) as { next: string | null; severity?: string | null; health: string; name: string };
      const msg = sum.next && sum.severity !== "low" && sum.severity !== "info" ? `Next: ${sum.next}` : sum.health;
      lines.push(`  ${bold("This folder")} ${dim(`(${fit(sum.name, 24).trim()})`)}  ${fit(msg.replace(/\s+/g, " "), W - 40).trimEnd()}`);
    } catch {
      /* not analyzed yet */
    }
  }
  lines.push(dim(`  bp ui = window · bp today = your day · bp help`));
  return lines.join("\n");
}
