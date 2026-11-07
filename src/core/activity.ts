import type { HookEvent, Session } from "./types";

/**
 * "What is it doing right now?" for one Claude Code session, from the hook events BuildPilot already records.
 * Pure: give it the session and its recent events (newest last). Never guesses: no event = null.
 */
export interface TimelineItem { ts: number; text: string; error: boolean; full?: string }
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
  /** Failed tool calls that are normal trial-and-error (search found nothing, edit text didn't match). */
  retries1h: number;
  /** Last turn finished: when, and how long it took (for "finished, your turn" alerts). */
  finishedAt: number | null;
  turnMs: number | null;
  /** No new activity for 10+ minutes while working. */
  maybeStuck: boolean;
  /** Full text of the current action (for tooltips). */
  nowFull: string | null;
}

/** Normal trial-and-error, not a real problem: searches with no matches, edits whose text didn't match, grep/test exit 1. */
export function isRetry(e: HookEvent): boolean {
  if (!e.isError) return false;
  const t = (e.errorText ?? "").toLowerCase();
  if (e.toolName === "Grep" || e.toolName === "Glob" || /^✗ search /i.test(e.summary)) return true;
  if (/no matches|no files found|string to replace not found|old_string|did not match|not unique|file has not been read yet|must read the file/.test(t)) return true;
  if (e.toolName === "Bash" && /^✗ run: (grep|rg|egrep|test|\[|diff|cmp|which|command -v|ls )/i.test(e.summary) && (/exit code 1\b/.test(t) || t.length < 40)) return true;
  return false;
}

const ACT: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^Run: (.+)$/, (m) => plainCommand(m[1]!)],
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
  // Plain English for common housekeeping commands.
  const port = c.match(/kill(?:\s+-9)?\s+\$\(lsof\s+-ti\s*:?(\d+)\)/);
  if (port) return `freeing port ${port[1]}`;
  if (/^(sleep|wait)\b/.test(c)) return "waiting";
  for (let i = 0; i < 3; i++) c = c.replace(/^cd\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)\s*/, "").replace(/^([A-Z_][A-Z0-9_]*=("[^"]*"|'[^']*'|\S+)\s+)+/, "");
  // Shell control words aren't commands: "until curl …" → "curl …".
  const parts = c.split(/\s*(?:\|\||&&|;)\s*/).map((x) => (x.split(/\s*\|\s*/)[0] ?? x).trim().replace(/^(until|while|for|if|then|else|elif|do|done|fi|time|nohup|exec|!)\s+/, "").trim()).filter((x) => x && !/^(do|done|fi|then|else|true|false)$/.test(x));
  // Prefer the command that matters (build/test/run) over setup like mkdir/cd/export/echo.
  const meaningful = parts.find((x) => /^(npx|npm|pnpm|yarn|bun|node|deno|python3?|pytest|uv|pip3?|cargo|go|make|tsc|vitest|jest|playwright|git|docker|gh|swift|xcodebuild|ruby|rails|bundle|php|mvn|gradle|dotnet|bash|sh|\.\/)/.test(x));
  const skip = /^(mkdir|cd|export|echo|printf|set|true|sleep|clear|source|\.)\b/;
  const first = meaningful ?? parts.find((x) => !skip.test(x)) ?? parts[0] ?? c;
  return first.length > 56 ? `${first.slice(0, 55)}…` : first;
}

/** A shell command in plain words for non-engineers: "npx vitest run" → "Running tests". Full text stays in the tooltip. */
export function plainCommand(cmd: string): string {
  const sc = shortCommand(cmd);
  if (/^(freeing|waiting)/.test(sc)) return sc.charAt(0).toUpperCase() + sc.slice(1);
  const c = sc.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/(^|[\s/._-])(test|tests|vitest|jest|pytest|playwright|mocha|spec)([\s:._-]|$)|\bnpm t\b/, "Running tests"],
    [/\b(typecheck|tsc)\b/, "Checking for type errors"],
    [/\b(lint|eslint|ruff|prettier|swiftlint)\b/, "Checking code style"],
    [/\b(npm|pnpm|yarn|bun) (i|install|add|ci)\b|\b(pip3?|uv pip|brew|gem|cargo) (install|add)\b|^bundle( install)?$/, "Installing packages"],
    [/\b(build|xcodebuild|compile|package|vsce)\b/, "Building the app"],
    [/\b(dev|start|serve|preview)\b|\bnext dev\b|\bvite\b/, "Starting the app"],
    [/^git (commit|add)\b/, "Saving changes to git"],
    [/^git push\b/, "Pushing to GitHub"],
    [/^git (pull|fetch|clone)\b/, "Getting the latest code"],
    [/^git (status|diff|log|show|branch|rev-parse)\b/, "Looking at recent changes"],
    [/^git\b/, "Using git"],
    [/^gh\b/, "Talking to GitHub"],
    [/^(curl|wget|open)\b/, "Checking a web address"],
    [/^(sed|perl) -i\b/, "Editing a file"],
    [/^(ls|cat|head|tail|find|grep|rg|wc|tree|stat|file|du|sed|awk|jq|sort|uniq|cut)\b/, "Looking through files"],
    [/^(rm|mv|cp|mkdir|touch|chmod|ln)\b/, "Moving files around"],
    [/^(npx )?(python3?|node|deno|tsx|ts-node|ruby|bash|sh|zsh|osascript|swift)\b/, "Running a script"],
    [/^(tar|zip|unzip|gzip|ditto)\b/, "Packing or unpacking files"],
    [/^(docker|kubectl)\b/, "Working with containers"],
    [/^(wrangler|vercel|netlify|fly|az|gcloud|aws)\b/, "Deploying or checking the cloud"],
    [/^(npx|npm|pnpm|yarn|bun) /, "Running a project script"],
  ];
  for (const [re, words] of rules) if (re.test(c)) return words;
  const word = (sc.split(/\s+/)[0] ?? "").split("/").pop() ?? "";
  return /^[a-z][\w.-]{1,30}$/i.test(word) ? `Running ${word}` : "Running a command";
}

/** "Run: npm test" → "Running tests". */
export function presentTense(summary: string): string {
  const s = (summary.replace(/^[✓✗] /, "").split("\n")[0] ?? "").trim();
  for (const [re, f] of ACT) {
    const m = s.match(re);
    if (m) return f(m);
  }
  return s;
}

const PAST: Record<string, string> = { Running: "Ran", Building: "Built", Checking: "Checked", Installing: "Installed", Starting: "Started", Saving: "Saved", Pushing: "Pushed", Getting: "Got", Looking: "Looked", Using: "Used", Talking: "Talked", Moving: "Moved", Packing: "Packed", Working: "Worked", Deploying: "Deployed", Editing: "Edited", Writing: "Wrote", Reading: "Read", Searching: "Searched", Opening: "Opened", Updating: "Updated", Freeing: "Freed", Waiting: "Waited" };

/** A finished step in plain past tense: "✓ Run: npx vitest" → "Ran tests". Prompts, approvals and other text pass through. */
export function plainStep(summary: string): string {
  const s = (summary.split("\n")[0] ?? "").trim();
  if (/^Prompt: /.test(s)) return s.replace(/^Prompt: /, "You: ");
  const bare = s.replace(/^[✓✗] /, "");
  if (!ACT.some(([re]) => re.test(bare))) return bare.replace(/^Needs your approval: (.+)$/, (_, x: string) => `Asked you before ${presentTense(x).replace(/^\w/, (c) => c.toLowerCase())}`);
  const p = presentTense(bare);
  return p.replace(/^\w+/, (w) => PAST[w] ?? w);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function activityFor(s: Session, events: HookEvent[], now: number): Activity {
  const ev = [...events].sort((a, b) => a.ts - b.ts || a.id - b.id);
  const last = ev[ev.length - 1];
  const recentFails = ev.filter((e) => e.isError && now - e.ts < 3600_000);
  const errs = recentFails.filter((e) => !isRetry(e));
  const retries1h = recentFails.length - errs.length;
  const lastErrors = errs.slice(-3).reverse().map((e) => clip((e.errorText || e.summary).replace(/\s+/g, " ").trim(), 160));
  // Current action: an unfinished PreToolUse wins; otherwise "Thinking" right after a prompt or a finished tool.
  let nowText: string | null = null;
  let pendingFull: string | null = null;
  let since: number | null = null;
  if (last && !s.endedAt && s.status !== "idle" && s.status !== "completed") {
    const finished = new Set(ev.filter((e) => e.hookEvent === "PostToolUse" || e.hookEvent === "PostToolUseFailure").map((e) => e.toolUseId).filter(Boolean));
    const pending = [...ev].reverse().find((e) => e.hookEvent === "PreToolUse" && (!e.toolUseId || !finished.has(e.toolUseId)) && e.ts >= (ev.filter((x) => x.hookEvent === "Stop").pop()?.ts ?? 0));
    if (pending && (!last || pending.ts >= last.ts - 1 || last.hookEvent === "PreToolUse" || last.hookEvent === "PermissionRequest" || last.hookEvent === "Notification")) {
      nowText = presentTense(pending.summary);
      pendingFull = pending.summary.replace(/^[✓✗] /, "").slice(0, 400);
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
  const finish = last?.hookEvent === "Stop" ? last : null;
  const turnStart = finish ? [...ev].reverse().find((e) => e.hookEvent === "UserPromptSubmit" && e.ts <= finish.ts) ?? null : null;
  const SHOW = new Set(["UserPromptSubmit", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "Stop", "StopFailure", "PreCompact", "SessionStart", "SessionEnd", "SubagentStop"]);
  const timeline = ev
    .filter((e) => SHOW.has(e.hookEvent))
    .slice(-10)
    .reverse()
    .map((e) => ({ ts: e.ts, error: e.isError, full: e.summary.slice(0, 400), text: clip(e.hookEvent === "Stop" ? "Finished its turn" : e.hookEvent === "PreCompact" ? "Compacted its memory (summarized the chat)" : e.hookEvent === "SessionStart" ? "Started" : e.hookEvent === "SessionEnd" ? "Closed" : e.hookEvent === "SubagentStop" ? "A helper finished" : plainStep(e.summary), 110) }));
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
    retries1h,
    finishedAt: finish?.ts ?? null,
    turnMs: finish && turnStart ? finish.ts - turnStart.ts : null,
    // "May be stuck" only when Claude is thinking with nothing running for 10+ minutes (a long npm test is fine).
    maybeStuck: nowText === "Thinking" && now - s.lastEventAt > 10 * 60_000 && s.status === "running",
    nowFull: pendingFull,
  };
}
