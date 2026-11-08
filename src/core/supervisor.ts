import * as path from "path";
import { testRunKind } from "./activity";
import { RepoFacts, SecretFinding } from "./analyzer";
import { AuditResult, VisualCheck } from "./checks";
import { DoctorCheck } from "./doctor";
import { LiveStatus } from "./hooks";
import { isEditTool } from "./ingest";
import {
  ChangeSet,
  Confidence,
  EvidenceItem,
  HookEvent,
  Issue,
  Recommendation,
  Requirement,
  Session,
  SessionStatus,
  Severity,
  Stage,
  TestRun,
} from "./types";

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
const files = (n: number): string => plural(n, "file");

/**
 * Deterministic supervisor. Pure functions over observed facts -> inferences -> recommendations.
 * No LLM calls here. Every output carries the evidence it was derived from.
 */

export const STALE_MS = 10 * 60_000;
export const ACTIVE_MS = 2 * 60 * 60_000;
const SEV_WEIGHT: Record<Severity, number> = { blocker: 100, high: 60, medium: 30, low: 10, info: 1 };

export interface SessionView extends Session {
  displayStatus: SessionStatus;
  displayReason: string;
  recent: HookEvent[];
  editedFiles: string[];
  lastError: string | null;
  overlapsWith: string[];
  intervention: string | null;
}

export interface SupervisorInput {
  now: number;
  facts: RepoFacts | null;
  changes: ChangeSet | null;
  sessions: Session[];
  eventsBySession: Map<string, HookEvent[]>; // newest last
  testRuns: TestRun[]; // newest first
  requirements: Requirement[];
  doctor: DoctorCheck[];
  secrets: SecretFinding[] | null; // null = not scanned
  hooksInstalled: boolean;
  claudeInstalled: boolean | null;
  dismissed: Set<string>;
  hasCheckpointSinceChanges: boolean;
  live?: Record<string, LiveStatus | null>; // from the statusline integration
  audit?: AuditResult | null;
  drift?: string[]; // recent prompts not covered by any requirement
  visual?: VisualCheck | null;
}

export interface SupervisorOutput {
  stage: { stage: Stage; confidence: Confidence; evidence: EvidenceItem[] };
  progress: { done: number; total: number; label: string; confidence: Confidence };
  health: { level: "good" | "attention" | "blocked" | "unknown"; label: string };
  sessions: SessionView[];
  issues: Issue[];
  recommendations: Recommendation[];
  next: Recommendation | null;
  readiness: ReadinessItem[];
}

export interface ReadinessItem {
  key: string;
  label: string;
  status: Confidence; // verified = passed with evidence; failed; unknown; unverified (recommendation only)
  detail: string;
}

// ---------- sessions ----------

export function normalizeError(e: string): string {
  return e
    .split("\n")
    .slice(0, 3)
    .join(" ")
    .replace(/\d+(\.\d+)?m?s\b/g, "#")
    .replace(/:\d+:\d+/g, ":#:#")
    .replace(/0x[0-9a-f]+/gi, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function deriveDisplayStatus(s: Session, now: number): { status: SessionStatus; reason: string } {
  if (s.endedAt) return { status: s.status === "failed" ? "failed" : "completed", reason: s.statusReason };
  const quiet = now - s.lastEventAt;
  if (s.status === "running" && quiet > STALE_MS) {
    return { status: "unknown", reason: `No activity seen for ${Math.round(quiet / 60_000)} min. It may be running a long command, or the terminal may have been closed.` };
  }
  if ((s.status === "idle" || s.status === "awaiting_approval" || s.status === "blocked") && quiet > 12 * 60 * 60_000) {
    return { status: "unknown", reason: "No activity for over 12 hours. The session was probably closed without a clean exit." };
  }
  return { status: s.status, reason: s.statusReason };
}

export interface LoopFinding {
  sessionId: string;
  kind: "repeated_error" | "file_churn" | "repeated_command_failure";
  count: number;
  detail: string;
  ref?: string;
}

export function detectLoops(sessionId: string, events: HookEvent[], now: number, windowMs = 60 * 60_000): LoopFinding[] {
  const recent = events.filter((e) => now - e.ts <= windowMs);
  const out: LoopFinding[] = [];
  const errCounts = new Map<string, number>();
  for (const e of recent) if (e.isError && e.errorText) {
    const k = normalizeError(e.errorText);
    errCounts.set(k, (errCounts.get(k) ?? 0) + 1);
  }
  for (const [k, n] of errCounts) if (n >= 3) out.push({ sessionId, kind: "repeated_error", count: n, detail: k });
  const cmdFail = new Map<string, number>();
  for (const e of recent) if (e.isError && e.toolName === "Bash") cmdFail.set(e.summary, (cmdFail.get(e.summary) ?? 0) + 1);
  for (const [k, n] of cmdFail) if (n >= 3 && !out.some((o) => o.kind === "repeated_error")) out.push({ sessionId, kind: "repeated_command_failure", count: n, detail: k.replace(/^✗ /, "") });
  const editCounts = new Map<string, number>();
  for (const e of recent) if (e.hookEvent === "PostToolUse" && isEditTool(e.toolName) && e.filePath) editCounts.set(e.filePath, (editCounts.get(e.filePath) ?? 0) + 1);
  const errorsInWindow = recent.filter((e) => e.isError).length;
  for (const [f, n] of editCounts) if (n >= 8 && errorsInWindow >= 2) out.push({ sessionId, kind: "file_churn", count: n, detail: `${path.basename(f)} edited ${n} times while errors kept happening`, ref: f });
  return out;
}

export interface ConflictFinding {
  file: string;
  sessions: string[];
  certainty: "actual" | "possible";
}

/** Same file edited by 2+ active sessions = actual overlap. Different files in the same working tree = possible. */
export function detectConflicts(sessions: Session[], eventsBySession: Map<string, HookEvent[]>, now: number): ConflictFinding[] {
  const active = sessions.filter((s) => !s.endedAt && now - s.lastEventAt < ACTIVE_MS);
  const fileOwners = new Map<string, Set<string>>();
  for (const s of active) {
    for (const e of eventsBySession.get(s.id) ?? []) {
      if (e.hookEvent === "PostToolUse" && isEditTool(e.toolName) && e.filePath && now - e.ts < ACTIVE_MS) {
        const set = fileOwners.get(e.filePath) ?? new Set<string>();
        set.add(s.id);
        fileOwners.set(e.filePath, set);
      }
    }
  }
  const out: ConflictFinding[] = [];
  for (const [file, owners] of fileOwners) if (owners.size > 1) out.push({ file, sessions: [...owners], certainty: "actual" });
  // possible: 2+ active editing sessions sharing the same cwd (same working tree, no worktree isolation)
  const byCwd = new Map<string, string[]>();
  for (const s of active) {
    const edits = (eventsBySession.get(s.id) ?? []).some((e) => isEditTool(e.toolName));
    if (!edits) continue;
    byCwd.set(s.cwd, [...(byCwd.get(s.cwd) ?? []), s.id]);
  }
  for (const [cwd, ids] of byCwd) if (ids.length > 1 && !out.some((o) => o.certainty === "actual" && o.sessions.every((x) => ids.includes(x)))) {
    out.push({ file: cwd, sessions: ids, certainty: "possible" });
  }
  return out;
}

export function isTestCommand(summary: string): boolean {
  return testRunKind(summary) === "run"; // piped runs (npm test | tail) report the pipe's exit code, not the tests'
}

/** After a session says it's done: were there edits after the last test it ran? */
export function unverifiedCompletion(events: HookEvent[]): { editsAfterTest: number; ranTests: boolean; lastTestFailed: boolean } | null {
  const lastStop = [...events].reverse().find((e) => e.hookEvent === "Stop");
  if (!lastStop) return null;
  const lastPrompt = [...events].reverse().find((e) => e.hookEvent === "UserPromptSubmit" && e.ts <= lastStop.ts);
  const turn = events.filter((e) => e.ts >= (lastPrompt?.ts ?? 0) && e.ts <= lastStop.ts);
  const edits = turn.filter((e) => e.hookEvent === "PostToolUse" && isEditTool(e.toolName));
  if (edits.length === 0) return null;
  const tests = turn.filter((e) => (e.hookEvent === "PostToolUse" || e.hookEvent === "PostToolUseFailure") && e.toolName === "Bash" && isTestCommand(e.summary));
  const lastTest = tests[tests.length - 1];
  const editsAfterTest = lastTest ? edits.filter((e) => e.ts > lastTest.ts).length : edits.length;
  return { editsAfterTest, ranTests: tests.length > 0, lastTestFailed: lastTest?.isError ?? false };
}

export function buildSessionViews(input: SupervisorInput, conflicts: ConflictFinding[]): SessionView[] {
  return input.sessions
    .map((s) => {
      const ev = input.eventsBySession.get(s.id) ?? [];
      const ds = deriveDisplayStatus(s, input.now);
      const edited = [...new Set(ev.filter((e) => e.hookEvent === "PostToolUse" && isEditTool(e.toolName) && e.filePath).map((e) => e.filePath!))];
      const lastErr = [...ev].reverse().find((e) => e.isError);
      const overlaps = new Set<string>();
      for (const c of conflicts) if (c.sessions.includes(s.id)) c.sessions.filter((x) => x !== s.id).forEach((x) => overlaps.add(x));
      let intervention: string | null = null;
      if (ds.status === "awaiting_approval") intervention = "It's waiting for you to approve an action in its terminal.";
      else if (ds.status === "blocked") intervention = "It needs your input in its terminal.";
      else if (ds.status === "failed") intervention = "The last turn failed. Check the terminal; try again or switch strategy.";
      else if (ds.status === "unknown" && !s.endedAt) intervention = "Check whether this terminal is still open.";
      const loops = detectLoops(s.id, ev, input.now);
      if (loops.length) intervention = "It looks stuck in a loop. Stop it and change approach (see Supervisor).";
      return { ...s, displayStatus: ds.status, displayReason: ds.reason, recent: ev.slice(-30).reverse(), editedFiles: edited.slice(-20), lastError: lastErr?.errorText ?? null, overlapsWith: [...overlaps], intervention };
    })
    .sort((a, b) => b.lastEventAt - a.lastEventAt);
}

// ---------- project ----------

/** Most recent run of a test command (other scripts like build don't count). */
export function lastTestRun(runs: TestRun[]): TestRun | undefined {
  return runs.find((t) => /\b(test|vitest|jest|pytest|playwright)\b/.test(t.command));
}

export function classifyStage(i: SupervisorInput): { stage: Stage; confidence: Confidence; evidence: EvidenceItem[] } {
  const f = i.facts;
  if (!f) return { stage: "discovery", confidence: "unknown", evidence: [{ kind: "inferred", text: "Project not analyzed yet" }] };
  const ev: EvidenceItem[] = [];
  const lastTest = lastTestRun(i.testRuns);
  if (f.sourceFileCount === 0) {
    ev.push({ kind: "observed", text: "No source code files found" });
    if (f.docs.length > 0) {
      ev.push({ kind: "observed", text: `${f.docs.length} docs present` });
      return { stage: "planning", confidence: "inferred", evidence: ev };
    }
    return { stage: "discovery", confidence: "inferred", evidence: ev };
  }
  ev.push({ kind: "observed", text: `${f.sourceFileCount} source files, ${f.testFileCount} test files` });
  if (f.deployConfigs.length > 0 && f.hasCI && lastTest?.passed) {
    ev.push({ kind: "observed", text: `deploy config (${f.deployConfigs.join(", ")}), CI, last tests passed` });
    return { stage: (i.changes?.unstaged.length ?? 0) + (i.changes?.untracked.length ?? 0) > 0 ? "deployment" : "maintenance", confidence: "inferred", evidence: ev };
  }
  if (lastTest && !lastTest.passed) {
    ev.push({ kind: "observed", text: `last test run failed (${lastTest.command})` });
    return { stage: f.testFileCount > 5 ? "stabilization" : "testing", confidence: "inferred", evidence: ev };
  }
  if (f.sourceFileCount < 15 && f.testFileCount === 0) return { stage: "prototyping", confidence: "inferred", evidence: ev };
  const integrations = f.frameworks.filter((x) => /Stripe|Supabase|Firebase|Google APIs|Anthropic|OpenAI|Prisma|Drizzle/.test(x));
  if (integrations.length > 0 && f.testFileCount < 3) {
    ev.push({ kind: "observed", text: `integrations: ${integrations.join(", ")}` });
    return { stage: "integration", confidence: "inferred", evidence: ev };
  }
  if (f.testFileCount > 0 && lastTest?.passed) return { stage: "testing", confidence: "inferred", evidence: [...ev, { kind: "observed", text: "tests pass" }] };
  return { stage: "implementation", confidence: "inferred", evidence: ev };
}

export function computeProgress(reqs: Requirement[]): SupervisorOutput["progress"] {
  const active = reqs.filter((r) => r.status !== "dropped");
  if (active.length === 0) return { done: 0, total: 0, label: "Unknown. Add requirements to measure progress.", confidence: "unknown" };
  const verified = active.filter((r) => r.status === "done" && r.evidence === "verified").length;
  const claimed = active.filter((r) => r.status === "done").length;
  return {
    done: verified,
    total: active.length,
    label: `${verified} of ${active.length} requirements verified done${claimed > verified ? ` (${claimed - verified} more marked done without proof)` : ""}`,
    confidence: "verified",
  };
}

function rec(key: string, severity: Severity, title: string, why: string, evidence: EvidenceItem[], action?: Recommendation["action"], bonus = 0): Recommendation {
  return { key, severity, title, why, evidence, action, source: "rules", score: SEV_WEIGHT[severity] + bonus };
}

export function supervise(i: SupervisorInput): SupervisorOutput {
  const issues: Issue[] = [];
  const recs: Recommendation[] = [];
  const f = i.facts;
  const conflicts = detectConflicts(i.sessions, i.eventsBySession, i.now);
  const sessions = buildSessionViews(i, conflicts);
  const shortId = (id: string): string => (id.startsWith("demo-") ? `DEMO ${id.slice(5, 11)}` : id.slice(0, 8));

  // --- integration health
  if (i.claudeInstalled === false) {
    recs.push(rec("claude-missing", "medium", "Install Claude Code to see live sessions", "BuildPilot watches Claude Code sessions. Without it, only project analysis works.", [{ kind: "observed", text: "`claude` not found on PATH" }]));
  }
  if (!i.hooksInstalled) {
    recs.push(rec("hooks-missing", "medium", "Connect BuildPilot to Claude Code", "One-time setup so BuildPilot can see what each Claude Code session is doing. Your existing settings are kept, a backup is made first, and you can undo it anytime.", [{ kind: "observed", text: "BuildPilot hooks not found in Claude Code settings" }], { kind: "install_hooks" }, 5));
  }

  // --- sessions
  for (const s of sessions) {
    if (s.displayStatus === "awaiting_approval") {
      recs.push(rec(`approve:${s.id}`, "high", `Session ${shortId(s.id)} is waiting for your approval`, "Claude Code is paused until you approve or deny in its terminal.", [{ kind: "observed", text: s.displayReason }], { kind: "open_tab", tab: "sessions" }, 20));
    }
    if (s.displayStatus === "blocked") {
      recs.push(rec(`blocked:${s.id}`, "high", `Session ${shortId(s.id)} needs your input`, "It can't continue without an answer from you.", [{ kind: "observed", text: s.displayReason }], { kind: "open_tab", tab: "sessions" }, 15));
    }
    if (s.displayStatus === "failed" && i.now - s.lastEventAt < ACTIVE_MS) {
      issues.push({ key: `failed:${s.id}`, severity: "high", title: `Session ${shortId(s.id)}: last turn failed`, plain: "Claude Code hit an error from the AI service (for example a rate limit or outage), not necessarily a bug in your code.", evidence: [{ kind: "observed", text: s.displayReason }], sessionId: s.id });
    }
    for (const l of detectLoops(s.id, i.eventsBySession.get(s.id) ?? [], i.now)) {
      const title = l.kind === "file_churn" ? `Session ${shortId(s.id)} keeps rewriting the same file` : `Session ${shortId(s.id)} hit the same error ${l.count} times`;
      issues.push({ key: `loop:${s.id}:${l.kind}`, severity: "high", title, plain: "Repeating the same fix rarely works and burns time and usage. Stop, gather better diagnostics, then try a different approach.", evidence: [{ kind: "observed", text: l.detail, ref: l.ref }], sessionId: s.id });
      recs.push(rec(`loop:${s.id}:${l.kind}`, "high", "Break the loop: stop and diagnose before trying again", `Session ${shortId(s.id)} is repeating itself (${l.detail.slice(0, 120)}). A fresh, diagnostic-first prompt usually beats another attempt.`, [{ kind: "observed", text: `${l.count}× in the last hour` }], { kind: "prompt", goal: "bugfix", request: `Stop retrying. Diagnose the root cause of this repeated error before changing code: ${l.detail.slice(0, 200)}` }, 25));
    }
    const uc = !s.endedAt && s.displayStatus === "idle" ? unverifiedCompletion(i.eventsBySession.get(s.id) ?? []) : null;
    if (uc && (uc.editsAfterTest > 0 || uc.lastTestFailed)) {
      const why = uc.lastTestFailed ? "The last test it ran failed, but it stopped anyway." : uc.ranTests ? `It changed ${files(uc.editsAfterTest)} after the last test run.` : `It changed ${files(uc.editsAfterTest)} and didn't run any tests.`;
      issues.push({ key: `unverified:${s.id}`, severity: "medium", title: `Session ${shortId(s.id)} finished without proof it works`, plain: `${why} "Done" from an AI isn't the same as verified.`, evidence: [{ kind: "observed", text: why }], sessionId: s.id });
      if (f?.scripts.test) recs.push(rec(`verify:${s.id}`, "medium", "Verify the last change: run the tests", why, [{ kind: "observed", text: why }], { kind: "run_script", script: "test" }, 12));
    }
  }
  for (const c of conflicts) {
    if (c.certainty === "actual") {
      issues.push({ key: `conflict:${c.file}`, severity: "high", title: `Two sessions edited ${path.basename(c.file)}`, plain: "Two AI sessions changing the same file can overwrite each other's work. Let one finish, or give each its own Git worktree.", evidence: [{ kind: "observed", text: `sessions ${c.sessions.map(shortId).join(", ")}`, ref: c.file }], sessionId: c.sessions[0] });
      recs.push(rec(`conflict:${c.file}`, "high", "Stop two sessions editing the same file", "Overlapping edits are the most common way multi-agent work gets lost. Save a checkpoint, then give one session its own copy of the code (a Git worktree).", [{ kind: "observed", text: `${path.basename(c.file)} edited by ${c.sessions.length} sessions` }], { kind: "worktree", sessionId: c.sessions[c.sessions.length - 1]! }, 18));
    } else {
      issues.push({ key: `possible-conflict:${c.file}`, severity: "low", title: `${c.sessions.length} sessions editing the same working folder`, plain: "No file overlap yet, but both are changing the same copy of the code. Consider separate Git worktrees.", evidence: [{ kind: "inferred", text: `sessions ${c.sessions.map(shortId).join(", ")} share ${c.file}` }] });
    }
  }

  // --- repository
  if (f) {
    const realSecrets = (i.secrets ?? []).filter((x) => !x.likelyFixture);
    const fixtureSecrets = (i.secrets ?? []).filter((x) => x.likelyFixture);
    if (realSecrets.length > 0) {
      issues.push({ key: "secrets", severity: "blocker", title: `Possible secrets in ${files(new Set(realSecrets.map((s) => s.file)).size)}`, plain: "API keys or passwords appear to be written into your code. Anyone who sees the code can use them. Move them to a .env file and rotate the keys.", evidence: realSecrets.slice(0, 8).map((s) => ({ kind: "observed" as const, text: `${s.kind} at ${s.file}:${s.line}`, ref: `${s.file}:${s.line}` })) });
      recs.push(rec("secrets", "blocker", "Remove secrets from your code", "Leaked keys can be abused within minutes once code is public.", realSecrets.slice(0, 3).map((s) => ({ kind: "observed" as const, text: `${s.kind} at ${s.file}:${s.line}` })), { kind: "prompt", goal: "security", request: "Move hard-coded secrets into environment variables and document the variable names in .env.example." }, 30));
    }
    if (fixtureSecrets.length > 0) {
      issues.push({ key: "secrets-fixtures", severity: "low", title: `Secret-like values in ${plural(new Set(fixtureSecrets.map((s) => s.file)).size, "test/example file")}`, plain: "These look like test data. If any are real keys, remove and rotate them.", evidence: fixtureSecrets.slice(0, 5).map((s) => ({ kind: "observed" as const, text: `${s.kind} at ${s.file}:${s.line}`, ref: `${s.file}:${s.line}` })) });
    }
    for (const d of i.doctor) {
      if (d.status === "fail" || d.status === "warn") {
        issues.push({ key: `doctor:${d.key}`, severity: d.severity, title: `${d.label}: ${d.detail}`, plain: d.plain, evidence: d.evidence });
        if (d.key === "deps-installed") recs.push(rec("deps-installed", "high", "Install the project's dependencies", d.plain, d.evidence, { kind: "run_script", script: "install" }, 10));
        else if (d.severity === "blocker" || d.severity === "high") recs.push(rec(`doctor:${d.key}`, d.severity, `Fix: ${d.label}`, d.plain, d.evidence, d.key === "env-tracked" ? { kind: "prompt", goal: "security", request: `Stop tracking ${d.detail.replace("tracked by git: ", "")} in Git without deleting the local file, add it to .gitignore, and list which keys need rotating.` } : undefined));
      }
    }
    const lastTest = lastTestRun(i.testRuns);
    if (lastTest && !lastTest.passed) {
      issues.push({ key: "tests-failing", severity: "high", title: "Tests are failing", plain: "Something that used to work (or was expected to) doesn't. Fix this before adding features, or problems pile up.", evidence: [{ kind: "observed", text: `\`${lastTest.command}\` exited ${lastTest.exitCode} at ${new Date(lastTest.startedAt).toLocaleString()}` }] });
      recs.push(rec("tests-failing", "high", "Fix the failing tests before building more", "New features on top of broken tests hide which change broke what.", [{ kind: "observed", text: lastTest.outputTail.split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 300) }], { kind: "prompt", goal: "bugfix", request: `Make the failing tests pass (\`${lastTest.command}\`) without weakening or deleting tests.` }, 22));
    }
    if (f.sourceFileCount > 10 && f.testFileCount === 0) {
      issues.push({ key: "no-tests", severity: "medium", title: "No automated tests", plain: "Without tests, nobody (you or the AI) can tell if a change broke something.", evidence: [{ kind: "observed", text: `${f.sourceFileCount} source files, 0 test files` }] });
      recs.push(rec("no-tests", "medium", "Add tests for your most important flow", "A few tests on the core user journey catch most regressions AI edits introduce.", [{ kind: "observed", text: "0 test files" }], { kind: "prompt", goal: "tests", request: "Add automated tests for the most important user flow in this project." }, 8));
    } else if (f.testFileCount > 0 && !lastTest && (f.scripts.test || f.languages.includes("Python"))) {
      recs.push(rec("run-tests", "low", "Run the tests to establish a baseline", "Test status is unknown until the tests run once (by you, Claude or BuildPilot).", [{ kind: "observed", text: `${f.testFileCount} test files, no test run seen yet` }], f.scripts.test ? { kind: "run_script", script: "test" } : undefined, 6));
    }
    const dirty = (i.changes?.unstaged.length ?? 0) + (i.changes?.untracked.length ?? 0) + (i.changes?.staged.length ?? 0);
    if (!f.isGit && f.sourceFileCount > 0) {
      issues.push({ key: "no-git", severity: "high", title: "This project isn't using Git", plain: "Git is the undo button for code. Without it, a bad AI edit can't be reverted.", evidence: [{ kind: "observed", text: "not a git repository" }] });
      recs.push(rec("no-git", "high", "Turn on version control (Git)", "So any AI change can be undone safely.", [{ kind: "observed", text: "not a git repository" }], { kind: "prompt", goal: "explain", request: "Initialize Git for this project with a sensible .gitignore (never commit .env files) and make a first commit. Explain each step briefly." }, 14));
    } else if (dirty >= 15 && !i.hasCheckpointSinceChanges) {
      const busy = sessions.some((s) => s.displayStatus === "running");
      recs.push(rec("checkpoint", busy ? "high" : "medium", `Save a checkpoint (${dirty} uncommitted changes)`, "A lot of work isn't saved in Git. A checkpoint lets you roll back if the next AI change goes wrong. It doesn't change your files or branch.", [{ kind: "observed", text: `${i.changes?.unstaged.length ?? 0} modified, ${i.changes?.untracked.length ?? 0} new, ${i.changes?.staged.length ?? 0} staged` }], { kind: "checkpoint" }, busy ? 10 : 4));
    }
    if (!f.hasClaudeMd && f.sourceFileCount > 0) {
      recs.push(rec("claude-md", "low", "Give Claude Code a project brief (CLAUDE.md)", "Every new session starts from zero. A short brief with goals, commands and rules stops repeated mistakes and saves context.", [{ kind: "observed", text: "no CLAUDE.md" }], { kind: "prompt", goal: "handoff", request: "Create a concise CLAUDE.md for this project." }, 5));
    }
    if (i.requirements.length === 0 && f.checklistItems.length === 0) {
      recs.push(rec("requirements", "low", "Write down what \"done\" means", "Progress can't be measured without requirements. Add 3–7 things the product must do, with how you'd check each.", [{ kind: "observed", text: "no requirements tracked" }], undefined, 3));
    }
    const noAcceptance = i.requirements.filter((r) => r.status !== "dropped" && r.status !== "done" && !r.acceptance.trim());
    if (noAcceptance.length > 0) {
      issues.push({ key: "missing-acceptance", severity: "low", title: `${plural(noAcceptance.length, "requirement")} without acceptance criteria`, plain: "Without a clear \"this works when…\", AI agents declare victory early.", evidence: noAcceptance.slice(0, 5).map((r) => ({ kind: "observed" as const, text: r.title })) });
    }
    if (f.todoCount >= 20) {
      issues.push({ key: "todos", severity: "low", title: `${f.todoCount} TODO/FIXME notes in code`, plain: "Unfinished spots left by you or an AI. Some may be incomplete features.", evidence: f.todos.slice(0, 5).map((t) => ({ kind: "observed" as const, text: t.text, ref: `${t.file}:${t.line}` })) });
    }
  }


  // --- context & cost (documented statusline data only)
  for (const s of sessions) {
    const l = i.live?.[s.id];
    if (!l || s.endedAt || i.now - s.lastEventAt > ACTIVE_MS || l.contextPct == null) continue;
    if (l.contextPct >= 80) {
      recs.push(rec(`context:${s.id}`, l.contextPct >= 95 ? "high" : "medium", `Session ${shortId(s.id)} is ${Math.round(l.contextPct)}% full. Start fresh with a handoff`, "When the context window fills, Claude compacts (summarizes) its memory and starts forgetting details. A new session with a handoff keeps quality high.", [{ kind: "observed", text: `context ${Math.round(l.contextPct)}% of ${l.contextSize?.toLocaleString() ?? "?"} tokens (from Claude Code)` }], { kind: "prompt", goal: "handoff", request: "Continue where the previous session left off." }, l.contextPct >= 95 ? 16 : 6));
    }
  }
  const limits = Object.values(i.live ?? {}).filter((l): l is LiveStatus => !!l && i.now - l.updatedAt < 6 * 3600_000);
  const fiveH = Math.max(-1, ...limits.map((l) => l.fiveHourPct ?? -1));
  if (fiveH >= 85) {
    recs.push(rec("rate-limit-5h", fiveH >= 95 ? "high" : "medium", `You've used ${Math.round(fiveH)}% of your 5-hour Claude limit`, "Save the remaining budget for the most important task. Avoid broad \"analyze everything\" prompts and pick a smaller model for simple edits.", [{ kind: "observed", text: `rate_limits.five_hour = ${fiveH}% (from Claude Code)` }], undefined, 8));
  }

  // --- dependency audit
  if (i.audit?.ok) {
    const c = i.audit.counts;
    if (c.critical + c.high > 0) {
      issues.push({ key: "vulns", severity: "high", title: `${c.critical + c.high} high/critical dependency vulnerabilit${c.critical + c.high === 1 ? "y" : "ies"}`, plain: "Some libraries your app uses have known security holes. Most are fixed by upgrading.", evidence: i.audit.top.slice(0, 5).map((t) => ({ kind: "observed" as const, text: `${t.name} (${t.severity}): ${t.title}${t.fixAvailable ? " · fix available" : ""}` })) });
      recs.push(rec("vulns", "high", "Upgrade vulnerable dependencies", "Known vulnerabilities are the easiest way in for attackers, and fixes usually exist.", [{ kind: "observed", text: `${i.audit.tool}: ${c.critical} critical, ${c.high} high, ${c.moderate} moderate` }], { kind: "prompt", goal: "security", request: `Fix the high and critical vulnerabilities reported by ${i.audit.tool} with the smallest safe upgrades (no major-version jumps without asking). Packages: ${i.audit.top.filter((t) => t.severity === "critical" || t.severity === "high").map((t) => t.name).join(", ")}. Re-run the audit and the tests.` }, 9));
    }
  } else if (f && (f.lockfiles.includes("package-lock.json") || f.languages.includes("Python")) && !i.audit) {
    recs.push(rec("audit", "low", "Check dependencies for known vulnerabilities", "A one-minute check against public vulnerability databases.", [{ kind: "inferred", text: "no audit run yet" }], { kind: "audit" }, 2));
  }

  // --- requirements drift
  if (i.drift && i.drift.length >= 2) {
    issues.push({ key: "drift", severity: "low", title: `${i.drift.length} recent requests aren't in your requirements`, plain: "Work is happening that your plan doesn't mention. Either add it as a requirement or check it's really needed (scope creep).", evidence: i.drift.slice(0, 5).map((p) => ({ kind: "observed" as const, text: `"${p.slice(0, 140)}"` })) });
    recs.push(rec("drift", "low", "Add new work to your requirements (or drop it)", "Keeping requirements current is how BuildPilot measures real progress.", i.drift.slice(0, 3).map((p) => ({ kind: "observed" as const, text: `"${p.slice(0, 120)}"` })), { kind: "open_tab", tab: "memory" }, 2));
  }

  // --- visual QA
  if (i.visual && i.visual.reachable && i.visual.errorText && i.now - i.visual.checkedAt < 24 * 3600_000) {
    issues.push({ key: "visual-error", severity: "high", title: "The app shows an error in the browser", plain: "The page loads but displays an error, so users would see a broken screen.", evidence: [{ kind: "observed", text: `${i.visual.url}: ${i.visual.errorText}`, ref: i.visual.screenshot ?? undefined }] });
  }
  for (const r of recs) if (i.dismissed.has(r.key)) r.score = -1;
  const recommendations = recs.filter((r) => r.score >= 0).sort((a, b) => b.score - a.score);
  const sevOrder: Severity[] = ["blocker", "high", "medium", "low", "info"];
  issues.sort((a, b) => sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity));
  const health: SupervisorOutput["health"] = !f
    ? { level: "unknown", label: "Not analyzed yet" }
    : issues.some((x) => x.severity === "blocker")
      ? { level: "blocked", label: "Blocked: fix the top issue first" }
      : issues.some((x) => x.severity === "high")
        ? { level: "attention", label: "Needs attention" }
        : { level: "good", label: lastTestRun(i.testRuns)?.passed ? "Healthy: tests passing" : "No major problems found" };

  return {
    stage: classifyStage(i),
    progress: computeProgress(i.requirements),
    health,
    sessions,
    issues,
    recommendations,
    next: recommendations[0] ?? null,
    readiness: readiness(i),
  };
}

export function readiness(i: SupervisorInput): ReadinessItem[] {
  const f = i.facts;
  const lastOf = (re: RegExp): TestRun | undefined => i.testRuns.find((t) => re.test(t.command));
  const build = lastOf(/\bbuild\b/);
  const test = lastOf(/\btest\b|pytest|vitest|jest/);
  const items: ReadinessItem[] = [];
  items.push(build ? { key: "build", label: "Build succeeds", status: build.passed ? "verified" : "failed", detail: `${build.command} → exit ${build.exitCode} (${new Date(build.startedAt).toLocaleDateString()})` } : { key: "build", label: "Build succeeds", status: "unknown", detail: f?.scripts.build ? "Run the build to check." : "No build command defined." });
  items.push(test ? { key: "tests", label: "Tests pass", status: test.passed ? "verified" : "failed", detail: `${test.command} → exit ${test.exitCode}` } : { key: "tests", label: "Tests pass", status: "unknown", detail: f?.testFileCount ? "Tests exist but haven't been run here." : "No tests found." });
  const real = (i.secrets ?? []).filter((x) => !x.likelyFixture);
  items.push(i.secrets == null ? { key: "secrets", label: "No secrets in code", status: "unknown", detail: "Run a security scan." } : { key: "secrets", label: "No secrets in code", status: real.length ? "failed" : "verified", detail: real.length ? `${plural(real.length, "possible secret")}` : `High-confidence patterns: none found outside tests (not a full audit)${i.secrets.length ? `; ${i.secrets.length} in test/example files` : ""}` });
  const envCheck = i.doctor.find((d) => d.key === "env-vars");
  items.push({ key: "config", label: "Configuration documented", status: f?.envExampleVars.length ? (envCheck?.status === "ok" ? "verified" : "unverified") : "unknown", detail: f?.envExampleVars.length ? `${f.envExampleVars.length} variables in .env.example` : "No .env.example. Document required settings." });
  const a = i.audit;
  items.push(!a ? { key: "deps", label: "No known vulnerable dependencies", status: "unknown", detail: "Run a dependency audit." } : !a.ok ? { key: "deps", label: "No known vulnerable dependencies", status: "unknown", detail: a.error ?? "Audit failed" } : { key: "deps", label: "No known vulnerable dependencies", status: a.counts.critical + a.counts.high > 0 ? "failed" : "verified", detail: `${a.tool} ${new Date(a.ranAt).toLocaleDateString()}: ${a.counts.critical} critical, ${a.counts.high} high, ${a.counts.moderate} moderate` });
  const v = i.visual;
  items.push(!v ? { key: "visual", label: "App loads in a browser", status: "unknown", detail: "Run a visual check." } : { key: "visual", label: "App loads in a browser", status: v.reachable && !v.errorText ? "verified" : v.reachable ? "failed" : "unknown", detail: `${v.url}: ${v.note}` });
  items.push({ key: "errors", label: "Error handling", status: "unverified", detail: "Can't be verified automatically. Ask Supervisor to review error paths." });
  items.push({ key: "ci", label: "Automated checks (CI)", status: f?.hasCI ? "verified" : "unknown", detail: f?.hasCI ? "CI config present (not run here)" : "No CI configuration found" });
  items.push({ key: "observability", label: "Logging / monitoring", status: f?.frameworks.length ? "unverified" : "unknown", detail: "Recommendation: add error reporting before launch" });
  items.push({ key: "deploy", label: "Deployment config", status: f?.deployConfigs.length ? "verified" : "unknown", detail: f?.deployConfigs.length ? f.deployConfigs.join(", ") : "No deploy configuration found" });
  items.push({ key: "rollback", label: "Rollback possible", status: f?.isGit ? (i.changes?.head ? "verified" : "unverified") : "failed", detail: f?.isGit ? (i.changes?.head ? "Git history exists; checkpoints available" : "Git with no commits yet") : "No Git: no way to roll back" });
  return items;
}
