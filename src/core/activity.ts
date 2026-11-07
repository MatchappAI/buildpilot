import type { HookEvent, Session } from "./types";

/**
 * "What is it doing right now?" for one Claude Code session, from the hook events BuildPilot already records.
 * Pure: give it the session and its recent events (newest last). Never guesses: no event = null.
 */
export interface TimelineItem { ts: number; text: string; error: boolean }
export interface Activity {
  /** Plain description of the current action, e.g. "Running npm test", "Editing checkout.tsx", "Thinking". */
  now: string | null;
  /** When the current action started (for "· 4 min"). */
  nowSince: number | null;
  errors1h: number;
  /** Up to 3 most recent error lines (already redacted at ingest). */
  lastErrors: string[];
  /** The exact thing waiting for your approval, e.g. "Run: npm install stripe". */
  waitingFor: string | null;
  /** Claude stopped in the middle of a task (session ended, failed, or went silent before finishing). */
  stopped: boolean;
  /** Running with permissions skipped (auto-approve). */
  autoApprove: boolean;
  /** Last time the chat was compacted (summarized), if seen. */
  compactedAt: number | null;
  timeline: TimelineItem[];
}

const ACT: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^Run: (.+)$/, (m) => `Running ${shortCommand(m[1]!)}`],
  [/^Edit (.+)$/, (m) => `Editing ${m[1]}`],
  [/^Write (.+)$/, (m) => `Writing ${m[1]}`],
  [/^Read (.+)$/, (m) => `Reading ${m[1]}`],
  [/^Search (.+)$/, (m) => `Searching ${m[1]}`],
  [/^Fetch (.+)$/, (m) => `Opening ${m[1]}`],
  [/^Web search (.+)$/, (m) => `Searching the web for ${m[1]}`],
  [/^Subagent: (.*)$/, (m) => `Running a subagent${m[1] ? `: ${m[1]}` : ""}`],
  [/^Update todo list$/, () => "Updating its to-do list"],
  [/^Use (.+)$/, (m) => `Using ${m[1]}`],
];

/** Shell commands are noisy: drop a leading `cd <dir> &&`, env assignments and pipes after the first command. */
export function shortCommand(cmd: string): string {
  let c = cmd.trim();
  for (let i = 0; i < 3; i++) c = c.replace(/^cd\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)\s*/, "").replace(/^([A-Z_][A-Z0-9_]*=("[^"]*"|'[^']*'|\S+)\s+)+/, "");
  const first = c.split(/\s*(?:\|\||&&|\||;)\s*/)[0] ?? c;
  return first.length > 56 ? `${first.slice(0, 55)}…` : first;
}

/** "Run: npm test" → "Running npm test". */
export function presentTense(summary: string): string {
  const s = (summary.replace(/^[✓✗] /, "").split("\n")[0] ?? "").trim();
  for (const [re, f] of ACT) {
    const m = s.match(re);
    if (m) return f(m);
  }
  return s;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function activityFor(s: Session, events: HookEvent[], now: number): Activity {
  const ev = [...events].sort((a, b) => a.ts - b.ts || a.id - b.id);
  const last = ev[ev.length - 1];
  const errs = ev.filter((e) => e.isError && now - e.ts < 3600_000);
  const lastErrors = errs.slice(-3).reverse().map((e) => clip((e.errorText || e.summary).replace(/\s+/g, " ").trim(), 160));
  // Current action: an unfinished PreToolUse wins; otherwise "Thinking" right after a prompt or a finished tool.
  let nowText: string | null = null;
  let since: number | null = null;
  if (last && !s.endedAt && s.status !== "idle" && s.status !== "completed") {
    const finished = new Set(ev.filter((e) => e.hookEvent === "PostToolUse" || e.hookEvent === "PostToolUseFailure").map((e) => e.toolUseId).filter(Boolean));
    const pending = [...ev].reverse().find((e) => e.hookEvent === "PreToolUse" && (!e.toolUseId || !finished.has(e.toolUseId)) && e.ts >= (ev.filter((x) => x.hookEvent === "Stop").pop()?.ts ?? 0));
    if (pending && (!last || pending.ts >= last.ts - 1 || last.hookEvent === "PreToolUse" || last.hookEvent === "PermissionRequest" || last.hookEvent === "Notification")) {
      nowText = presentTense(pending.summary);
      since = pending.ts;
    } else if (last.hookEvent === "UserPromptSubmit" || last.hookEvent === "PostToolUse" || last.hookEvent === "PostToolUseFailure" || last.hookEvent === "SubagentStop") {
      nowText = "Thinking";
      since = last.ts;
    } else if (last.hookEvent === "PreCompact") {
      nowText = "Compacting its memory";
      since = last.ts;
    }
  }
  const perm = [...ev].reverse().find((e) => e.hookEvent === "PermissionRequest");
  const waitingFor = s.status === "awaiting_approval" && perm ? perm.summary.replace(/^Needs your approval: /, "") : null;
  // Stopped mid-task: the last prompt never got a Stop, and the session ended / failed / went quiet for 30+ min.
  const lastPrompt = [...ev].reverse().find((e) => e.hookEvent === "UserPromptSubmit");
  const stopAfter = lastPrompt ? ev.some((e) => e.ts >= lastPrompt.ts && e.hookEvent === "Stop") : true;
  // Only flag real interruptions: an API/turn failure, or an open session gone silent for 30 min – 6 h mid-turn.
  // A session that simply ended (closed terminal, headless run) is not "stopped mid-task".
  const failed = last?.hookEvent === "StopFailure";
  const quiet = now - s.lastEventAt;
  const stopped = !!lastPrompt && !stopAfter && s.status !== "awaiting_approval" && s.status !== "blocked" && (failed || (!s.endedAt && quiet > 30 * 60_000 && quiet < 6 * 3600_000));
  const compact = [...ev].reverse().find((e) => e.hookEvent === "PreCompact");
  const SHOW = new Set(["UserPromptSubmit", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "Stop", "StopFailure", "PreCompact", "SessionStart", "SessionEnd", "SubagentStop"]);
  const timeline = ev
    .filter((e) => SHOW.has(e.hookEvent))
    .slice(-15)
    .reverse()
    .map((e) => ({ ts: e.ts, error: e.isError, text: clip(e.hookEvent === "Stop" ? "Finished its turn" : e.hookEvent === "PreCompact" ? "Compacted its memory (summarized the chat)" : e.summary.replace(/^Prompt: /, "You: "), 140) }));
  return {
    now: nowText ? clip(nowText, 90) : null,
    nowSince: since,
    errors1h: errs.length,
    lastErrors,
    waitingFor: waitingFor ? clip(waitingFor, 140) : null,
    stopped,
    autoApprove: s.permissionMode === "bypassPermissions",
    compactedAt: compact?.ts ?? null,
    timeline,
  };
}
