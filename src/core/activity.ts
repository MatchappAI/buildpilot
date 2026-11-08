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
  /**
   * The latest request so far, from observed events only: steps taken, files changed, and proof.
   * proof: "verified" = tests passed after the last edit · "failing" = the last test run after editing failed ·
   * "unverified" = files changed but no test run since · null = no file changes (nothing to verify).
   */
  turn: { steps: number; files: number; proof: "verified" | "failing" | "unverified" | null; done: boolean } | null;
  /** Risky things Claude did in the last 3 hours, in plain words (destructive commands, secret files, test edits while failing). */
  risks: string[];
  /** No new activity for 10+ minutes while working. */
  maybeStuck: boolean;
  /** Full text of the current action (for tooltips). */
  nowFull: string | null;
}

const TEST_RUN = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|vitest|jest)\b|\bnpx\s+(vitest|jest|playwright)\b|\bpytest\b|\bgo test\b|\bcargo test\b|\bvitest\b|\bjest\b/;
const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/i;
const DESTRUCTIVE: Array<[RegExp, string]> = [
  [/\bgit\s+push\b[^\n]*(--force\b|-f\b|--force-with-lease)/, "force-pushed with git (can overwrite others' work)"],
  [/\bgit\s+reset\s+--hard\b/, "ran git reset --hard (throws away unsaved changes)"],
  [/\bgit\s+clean\s+-[a-z]*f/, "ran git clean (deletes untracked files)"],
  [/\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/, "discarded all unsaved changes with git"],
  [/\brm\s+-[a-z]*r[a-z]*f?\b|\brm\s+-[a-z]*f[a-z]*r\b/, "deleted folders with rm -rf"],
  [/\b(drop\s+(table|database)|truncate\s+table)\b/i, "dropped or emptied a database table"],
  [/--no-verify\b/, "skipped git safety checks (--no-verify)"],
];
const SECRET_FILE = /(^|\/)(\.env(\.[\w-]+)?|\.npmrc|\.pypirc|id_rsa|id_ed25519|credentials(\.json)?|secrets?\.(json|ya?ml))$/i;

/** Risky things in these events, newest first, each kind once. Observed only. */
export function risksIn(ev: HookEvent[]): string[] {
  const out: string[] = [];
  const add = (t: string) => { if (!out.includes(t)) out.push(t); };
  for (const e of [...ev].reverse()) {
    if (e.agentId == null && (e.hookEvent === "PostToolUse" || e.hookEvent === "PostToolUseFailure") && e.toolName === "Bash") {
      const cmd = e.summary.replace(/^[✓✗] Run: /, "");
      if (/\.example\b|\.sample\b/.test(cmd)) continue;
      for (const [re, text] of DESTRUCTIVE) {
        if (!re.test(cmd)) continue;
        if (/rm -rf/.test(text)) {
          // Name what was deleted; routine build/cache folders aren't worth a warning.
          const target = /\brm\s+-[a-z]+\s+("[^"]+"|'[^']+'|\S+)/.exec(cmd)?.[1]?.replace(/^["']|["']$/g, "") ?? "";
          if (!target || /(^|\/)(node_modules|dist|build|out|\.next|coverage|tmp|\.cache|__pycache__|\.turbo|\.parcel-cache)\/?$/.test(target) || /^\$?\(?mktemp|^\/tmp\/|^\$TMPDIR/.test(target)) continue;
          add(`It deleted ${target.length > 48 ? `${target.slice(0, 47)}…` : target} with rm -rf`);
        } else add(`It ${text}`);
      }
    }
    if (e.hookEvent === "PostToolUse" && isEditLike(e) && e.filePath && SECRET_FILE.test(e.filePath) && !/\.(example|sample|template)$/.test(e.filePath)) add(`It edited a secrets file (${e.filePath.split("/").pop()})`);
  }
  // Tests failing, then test files edited, then tests pass: worth a look (the fix may have weakened the test).
  const firstFail = ev.findIndex((e) => e.toolName === "Bash" && e.isError && TEST_RUN.test(e.summary));
  if (firstFail >= 0) {
    const after = ev.slice(firstFail);
    const testEdits = new Set(after.filter((e) => e.hookEvent === "PostToolUse" && isEditLike(e) && e.filePath && TEST_FILE.test(e.filePath)).map((e) => e.filePath));
    const passedLater = after.some((e) => e.hookEvent === "PostToolUse" && e.toolName === "Bash" && TEST_RUN.test(e.summary));
    if (testEdits.size && passedLater) add(`Tests were failing, then it changed ${testEdits.size} test file${testEdits.size === 1 ? "" : "s"} and they passed: check it fixed the code, not the test`);
  }
  return out.slice(0, 3);
}

const isEditLike = (e: HookEvent) => e.toolName === "Edit" || e.toolName === "Write" || e.toolName === "MultiEdit" || e.toolName === "NotebookEdit";

/** Steps, files and proof for the latest request (see Activity.turn). */
const SYSTEM_PROMPT = /^Prompt: (Message from another Claude session|Background task update|System update|Report from a helper|\[Subagent hand-back\])/;
/** The last prompt the person actually typed (Claude Code also submits helper reports and background updates). */
export const isUserPrompt = (e: HookEvent) => e.hookEvent === "UserPromptSubmit" && !SYSTEM_PROMPT.test(e.summary);

export function turnSummary(ev: HookEvent[]): Activity["turn"] {
  const start = [...ev].reverse().find(isUserPrompt);
  if (!start) return null;
  const turn = ev.filter((e) => e.ts >= start.ts && e.agentId == null);
  const steps = turn.filter((e) => e.hookEvent === "PostToolUse" || e.hookEvent === "PostToolUseFailure").length;
  const edits = turn.filter((e) => e.hookEvent === "PostToolUse" && isEditLike(e) && e.filePath);
  const files = new Set(edits.map((e) => e.filePath)).size;
  const lastEdit = edits[edits.length - 1];
  const testsAfter = lastEdit ? turn.filter((e) => e.ts >= lastEdit.ts && e.toolName === "Bash" && (e.hookEvent === "PostToolUse" || e.hookEvent === "PostToolUseFailure") && TEST_RUN.test(e.summary)) : [];
  const lastTest = testsAfter[testsAfter.length - 1];
  const proof = !files ? null : !lastTest ? "unverified" : lastTest.isError ? "failing" : "verified";
  return { steps, files, proof, done: turn.some((e) => e.hookEvent === "Stop") };
}

const MUST_WORK = new RegExp(
  `${TEST_RUN.source}|\\b(npm|pnpm|yarn|bun)\\s+(run\\s+)?(build|lint|typecheck|start|dev|ci|install|i|add)\\b|^(npx\\s+)?(tsc|eslint|ruff|mypy|prettier --check)\\b|\\b(cargo (build|check)|go build|make|gradle|mvn|xcodebuild|pip3? install|docker (build|compose)|git (commit|push|merge|rebase|pull))\\b|\\b(wrangler|vercel|netlify|fly) deploy\\b`,
  "i",
);

/** Normal trial-and-error, not a real problem: searches with no matches, edits whose text didn't match, grep/test exit 1. */
export function isRetry(e: HookEvent): boolean {
  if (!e.isError) return false;
  const t = (e.errorText ?? "").toLowerCase();
  if (e.toolName === "Grep" || e.toolName === "Glob" || /^✗ search /i.test(e.summary)) return true;
  if (/no matches|no files found|string to replace not found|old_string|did not match|not unique|file has not been read yet|must read the file/.test(t)) return true;
  // A shell command that exits non-zero is usually Claude exploring (grep, ls, a probe). It only counts as an error when
  // the command is one that has to work: tests, builds, type checks, lint, installs, running the app, git saves/pushes.
  if (e.toolName === "Bash" && !MUST_WORK.test(e.summary.replace(/^✗ run: /i, ""))) return true;
  return false;
}

/** Tool names in plain words; MCP tools become "Using <server>". */
function friendlyTool(name: string): string {
  const known: Record<string, string> = { ScheduleWakeup: "Setting a reminder to check back", AskUserQuestion: "Asking you a question", ExitPlanMode: "Presenting its plan", EnterPlanMode: "Planning", Skill: "Using a skill", Monitor: "Watching a background job", TaskCreate: "Updating its to-do list", TaskUpdate: "Updating its to-do list", TaskList: "Checking its to-do list", NotebookEdit: "Editing a notebook", ToolSearch: "Loading a tool", SendMessage: "Messaging a helper", KillShell: "Stopping a background job", BashOutput: "Checking a background job" };
  if (known[name]) return known[name]!;
  const mcp = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(name);
  if (mcp) return `Using ${mcp[1]!.replace(/^(claude_ai_|plugin_[^_]+_)/, "").replace(/[_-]+/g, " ")}`;
  return `Using ${name}`;
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
  [/^Use (.+)$/, (m) => friendlyTool(m[1]!)],
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
    // Read-only tools first: "ls test; grep foo" is looking around, not running tests.
    [/^(sed|perl) -i\b/, "Editing a file"],
    [/^(ls|cat|head|tail|find|grep|rg|wc|tree|stat|file|du|sed|awk|jq|sort|uniq|cut|echo|printf)\b/, "Looking through files"],
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

const PAST: Record<string, string> = { Running: "Ran", Building: "Built", Checking: "Checked", Installing: "Installed", Starting: "Started", Saving: "Saved", Pushing: "Pushed", Getting: "Got", Looking: "Looked", Using: "Used", Talking: "Talked", Moving: "Moved", Packing: "Packed", Working: "Worked", Deploying: "Deployed", Editing: "Edited", Writing: "Wrote", Reading: "Read", Searching: "Searched", Opening: "Opened", Updating: "Updated", Freeing: "Freed", Waiting: "Waited", Setting: "Set", Asking: "Asked", Presenting: "Presented", Planning: "Planned", Watching: "Watched", Loading: "Loaded", Messaging: "Messaged", Stopping: "Stopped" };

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
    turn: turnSummary(ev),
    risks: risksIn(ev.filter((e) => now - e.ts < 3 * 3600_000)),
    // "May be stuck": thinking with nothing running for 10+ minutes, or one step running for 20+ minutes.
    maybeStuck: s.status === "running" && ((nowText === "Thinking" && now - s.lastEventAt > 10 * 60_000) || (since != null && nowText !== "Thinking" && now - since > 20 * 60_000)),
    nowFull: pendingFull,
  };
}
