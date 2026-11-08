import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Store } from "./db";
import { clip } from "./redact";
import { Checklist, HookEvent, Session, SessionStatus } from "./types";

/**
 * Typed ingestion of Claude Code hook payloads.
 * Payloads are UNTRUSTED DATA: validated, clipped, redacted, and never executed or followed as instructions.
 */

export interface RawHookPayload {
  session_id: string;
  hook_event_name: string;
  cwd?: string;
  transcript_path?: string;
  permission_mode?: string;
  tool_name?: string;
  tool_use_id?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  error?: string;
  is_interrupt?: boolean;
  prompt?: string;
  message?: string;
  notification_type?: string;
  reason?: string;
  source?: string;
  agent_id?: string;
  agent_type?: string;
  model?: string;
  [k: string]: unknown;
}

export type ValidationResult = { ok: true; payload: RawHookPayload } | { ok: false; reason: string };

const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_EVENT = /^[A-Za-z]{2,40}$/;

export function validatePayload(raw: string): ValidationResult {
  if (raw.length === 0) return { ok: false, reason: "empty payload" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "malformed JSON (possibly truncated at 1 MB)" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false, reason: "payload is not an object" };
  const p = parsed as Record<string, unknown>;
  if (typeof p.session_id !== "string" || !SAFE_ID.test(p.session_id)) return { ok: false, reason: "missing or invalid session_id" };
  if (typeof p.hook_event_name !== "string" || !SAFE_EVENT.test(p.hook_event_name)) return { ok: false, reason: "missing or invalid hook_event_name" };
  for (const k of ["cwd", "transcript_path", "tool_name", "prompt", "error", "message", "notification_type", "reason", "source"] as const) {
    if (p[k] !== undefined && typeof p[k] !== "string") return { ok: false, reason: `field ${k} has wrong type` };
  }
  if (p.tool_input !== undefined && (typeof p.tool_input !== "object" || p.tool_input === null)) return { ok: false, reason: "tool_input is not an object" };
  return { ok: true, payload: p as RawHookPayload };
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export function toolFilePath(p: RawHookPayload): string | null {
  const ti = p.tool_input ?? {};
  return str(ti.file_path) ?? str(ti.notebook_path) ?? null;
}

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
export function isEditTool(name: string | null): boolean {
  return !!name && EDIT_TOOLS.has(name);
}

/**
 * Turn what Claude Code submitted as a "prompt" into what the user actually asked.
 * Claude Code also submits system-injected messages (other sessions, background tasks) and expands pastes,
 * so those become short readable labels instead of raw markup.
 */
export function cleanPrompt(raw: string): string {
  let t = raw.trim();
  const tag = /^<([a-z][\w-]*)\b/i.exec(t)?.[1]?.toLowerCase();
  if (tag === "cross-session-message") return "Message from another Claude session";
  if (tag === "task-notification") return "Background task update";
  if (tag === "system-reminder") return "System update";
  if (/^\[Subagent hand-back\]/.test(t)) return "Report from a helper";
  if (tag === "command-name" || tag === "command-message") {
    const cmd = /<command-name>([^<]*)<\/command-name>/.exec(t)?.[1];
    return cmd ? `Ran ${cmd.trim()}` : "Ran a slash command";
  }
  t = t.replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, "[pasted text]");
  t = t.replace(/<\/?[a-z][\w-]*(\s[^>]*)?>/gi, " ").replace(/\s+/g, " ").trim();
  // Text copied from a terminal often starts with the shell/Claude prompt glyph.
  t = t.replace(/^(?:❯|›|»)\s*/, "");
  return t || "[pasted text]";
}

const SYSTEM_LABELS = new Set(["Message from another Claude session", "Background task update", "System update", "Report from a helper"]);
/** True for messages Claude Code injected itself (not something the user asked for). */
export function isSystemPrompt(cleaned: string): boolean {
  return SYSTEM_LABELS.has(cleaned);
}

export function summarize(p: RawHookPayload): string {
  const ti = p.tool_input ?? {};
  const tool = p.tool_name ?? "";
  const fp = toolFilePath(p);
  const toolPhrase = (): string => {
    if (tool === "Bash") return `Run: ${clip(str(ti.command) ?? "", 160)}`;
    if (EDIT_TOOLS.has(tool)) return `${tool === "Write" ? "Write" : "Edit"} ${fp ? path.basename(fp) : "file"}`;
    if (tool === "Read") return `Read ${fp ? path.basename(fp) : "file"}`;
    if (tool === "Grep" || tool === "Glob") return `Search ${clip(str(ti.pattern) ?? "", 80)}`;
    if (tool === "WebFetch") return `Fetch ${clip(str(ti.url) ?? "", 120)}`;
    if (tool === "WebSearch") return `Web search ${clip(str(ti.query) ?? "", 100)}`;
    if (tool === "Task" || tool === "Agent") return `Subagent: ${clip(str(ti.description) ?? str(ti.subagent_type) ?? "", 100)}`;
    if (tool === "TodoWrite") return "Update todo list";
    return `Use ${clip(tool, 60)}`;
  };
  switch (p.hook_event_name) {
    case "SessionStart":
      return `Session started (${clip(p.source ?? "startup", 30)})`;
    case "SessionEnd":
      return `Session ended (${clip(p.reason ?? "other", 40)})`;
    case "UserPromptSubmit":
      return `Prompt: ${clip(cleanPrompt(p.prompt ?? ""), 200)}`;
    case "PreToolUse":
      return toolPhrase();
    case "PostToolUse":
      return `✓ ${toolPhrase()}`;
    case "PostToolUseFailure":
      return p.is_interrupt ? `Interrupted: ${toolPhrase()}` : `✗ ${toolPhrase()}`;
    case "PermissionRequest":
      return `Needs your approval: ${toolPhrase()}`;
    case "Notification":
      return `Notice: ${clip(p.message ?? p.notification_type ?? "", 160)}`;
    case "Stop":
      return "Finished responding";
    case "StopFailure":
      return `Turn failed (${clip(str(p.error_type) ?? str(p.error) ?? p.reason ?? "API error", 60)})`;
    case "SubagentStart":
      return p.agent_type ? `Subagent started (${clip(p.agent_type, 40)})` : "Subagent started";
    case "SubagentStop":
      return p.agent_type ? `Subagent finished (${clip(p.agent_type, 40)})` : "Subagent finished";
    case "PreCompact":
      return "Compacting context";
    default:
      return clip(p.hook_event_name, 40);
  }
}

/** Status after this event, or null to leave unchanged. Only states the event actually supports are set. */
export function nextStatus(p: RawHookPayload): { status: SessionStatus; reason: string } | null {
  switch (p.hook_event_name) {
    case "SessionStart":
      return { status: "idle", reason: "Started, waiting for a prompt" };
    case "UserPromptSubmit":
      return { status: "running", reason: "Working on your prompt" };
    case "PreToolUse":
    case "PostToolUse":
    case "PostToolUseFailure":
    case "SubagentStart":
    case "SubagentStop":
    case "PreCompact":
      return { status: "running", reason: summarize(p) };
    case "PermissionRequest":
      return { status: "awaiting_approval", reason: summarize(p) };
    case "Notification": {
      const t = p.notification_type ?? "";
      if (t === "permission_prompt") return { status: "awaiting_approval", reason: clip(p.message ?? "Waiting for your approval", 160) };
      if (t === "idle_prompt") return { status: "idle", reason: "Waiting for your input" };
      if (t === "agent_needs_input" || t.startsWith("elicitation_dialog") || t === "elicitation_url_dialog")
        return { status: "blocked", reason: clip(p.message ?? "Needs your input", 160) };
      return null;
    }
    case "Stop":
      return { status: "idle", reason: "Finished its last response" };
    case "StopFailure":
      return { status: "failed", reason: summarize(p) };
    case "SessionEnd":
      return { status: "completed", reason: `Session ended (${clip(p.reason ?? "other", 40)})` };
    default:
      return null;
  }
}

/** Events arriving together are read in one pass. */
const DRAIN_BATCH_MS = 250;
/** Two identical payloads closer than this are one event delivered twice. */
export const DEDUPE_WINDOW_MS = 5000;
/** A tool event this soon after Stop/StopFailure/SessionEnd is a late background hook, not new work. */
const LATE_EVENT_MS = 5000;
const TERMINAL = new Set(["idle", "failed", "completed"]);

export interface IngestResult {
  accepted: boolean;
  duplicate?: boolean;
  reason?: string;
  sessionId?: string;
}

export class Ingestor {
  private checklistAfter(p: RawHookPayload, ts: number): Checklist | null | undefined {
    if (p.agent_id) return undefined; // a subagent's private list isn't the session's plan
    const isList = (p.hook_event_name === "PreToolUse" && /^(TodoWrite|TaskCreate|TaskUpdate)$/.test(p.tool_name ?? "")) || p.hook_event_name === "TaskCreated" || p.hook_event_name === "TaskCompleted";
    if (!isList) return undefined;
    const raw = this.store.scalar("SELECT checklist FROM sessions WHERE id = ?", [p.session_id]);
    let prev: Checklist | null = null;
    try {
      prev = raw ? (JSON.parse(String(raw)) as Checklist) : null;
    } catch {
      prev = null;
    }
    return nextChecklist(prev, p, ts);
  }

  constructor(
    private readonly store: Store,
    private readonly resolveProject: (cwd: string) => string | null,
  ) {}

  ingestRaw(raw: string, ts = Date.now()): IngestResult {
    const v = validatePayload(raw);
    if (!v.ok) return { accepted: false, reason: v.reason };
    // Same bytes within a few seconds = the same event delivered twice (plugin + settings hooks both installed).
    // Same bytes later = a genuine repeat ("yes", a second Stop or idle notice) and must count.
    const h = createHash("sha256").update(raw).digest("hex").slice(0, 32);
    const bucket = Math.floor(ts / DEDUPE_WINDOW_MS);
    return this.ingest(v.payload, ts, `${h}:${bucket}`, [`${h}:${bucket - 1}`]);
  }

  ingest(p: RawHookPayload, ts: number, fingerprint: string, alsoSeenAs: string[] = []): IngestResult {
    // Cheap early exit; the INSERT OR IGNORE below is the real (race-safe) duplicate guard.
    const keys = [fingerprint, ...alsoSeenAs];
    if (this.store.get(`SELECT 1 AS x FROM events WHERE fingerprint IN (${keys.map(() => "?").join(",")})`, keys)) {
      return { accepted: false, duplicate: true, reason: "duplicate", sessionId: p.session_id };
    }
    const isError = p.hook_event_name === "PostToolUseFailure" && !p.is_interrupt || p.hook_event_name === "StopFailure";
    const errorText = isError ? clip(p.error ?? str(p.error_details) ?? str(p.error_type) ?? "", 600) : null;
    const filePath = toolFilePath(p);
    const cwd = p.cwd ?? "";
    const existing = this.store.get<{ id: string; started_at: number; last_event_at: number; status: string; status_reason: string; ended_at: number | null }>(
      "SELECT id, started_at, last_event_at, status, status_reason, ended_at FROM sessions WHERE id = ?",
      [p.session_id],
    );
    if (!existing) {
      this.store.run(
        `INSERT OR IGNORE INTO sessions (id, project_id, cwd, transcript_path, status, status_reason, started_at, last_event_at, event_count, error_count)
         VALUES (?, ?, ?, ?, 'unknown', 'First event observed', ?, ?, 0, 0)`,
        [p.session_id, cwd ? this.resolveProject(cwd) : null, cwd, p.transcript_path ?? null, ts, ts],
      );
    }
    this.store.run(
      `INSERT OR IGNORE INTO events (session_id, hook_event, ts, tool_name, tool_use_id, summary, file_path, is_error, error_text, agent_id, fingerprint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.session_id, p.hook_event_name, ts, p.tool_name ?? null, p.tool_use_id ?? null, summarize(p), filePath, isError ? 1 : 0, errorText, p.agent_id ?? null, fingerprint],
    );
    if (this.store.changes() === 0) return { accepted: false, duplicate: true, reason: "duplicate", sessionId: p.session_id }; // another process got it first
    // Out-of-order safety: only let an event change status if it is not older than the latest one we have.
    const isLatest = !existing || ts >= existing.last_event_at;
    let ns = nextStatus(p);
    // Subagents report their own tool calls; they must not flip the main session back to "working" after it finished.
    // Approvals and questions from a subagent still need the user, so those pass through.
    if (ns && p.agent_id && ns.status === "running") ns = null;
    // Hooks run as separate background processes, so a tool event can land just after Stop. It doesn't restart the session.
    if (ns && existing && ns.status === "running" && p.hook_event_name !== "UserPromptSubmit" && TERMINAL.has(existing.status) && ts - existing.last_event_at < LATE_EVENT_MS) ns = null;
    const sets: string[] = ["event_count = event_count + 1"];
    const params: (string | number | null)[] = [];
    if (isError) sets.push("error_count = error_count + 1");
    if (isLatest) {
      sets.push("last_event_at = ?");
      params.push(ts);
      if (ns) {
        sets.push("status = ?", "status_reason = ?");
        params.push(ns.status, ns.reason);
      }
      // A session belongs to the folder it was started in (that's where its terminal is), even if Claude later
      // cd's into a subfolder or another repo. Only a new start (resume/clear) moves it.
      if (cwd && p.hook_event_name === "SessionStart") {
        sets.push("cwd = ?", "project_id = COALESCE(?, project_id)");
        params.push(cwd, this.resolveProject(cwd));
      }
    }
    if (p.hook_event_name === "SessionStart" && existing) sets.push("ended_at = NULL");
    // A session hidden as idle comes back as soon as Claude does something there again.
    else if (existing?.ended_at != null && existing.status_reason === "Hidden as idle" && p.hook_event_name !== "SessionEnd" && isLatest) sets.push("ended_at = NULL");
    if (p.hook_event_name === "SessionEnd") {
      sets.push("ended_at = ?");
      params.push(ts);
    }
    if (p.hook_event_name === "UserPromptSubmit" && p.prompt && !isSystemPrompt(cleanPrompt(p.prompt))) {
      sets.push("current_task = ?");
      params.push(clip(cleanPrompt(p.prompt), 300));
    }
    const cl = this.checklistAfter(p, ts);
    if (cl !== undefined) {
      sets.push("checklist = ?");
      params.push(cl ? JSON.stringify(cl) : null);
    }
    if (p.transcript_path) {
      sets.push("transcript_path = ?");
      params.push(p.transcript_path);
    }
    if (p.permission_mode) {
      sets.push("permission_mode = ?");
      params.push(clip(p.permission_mode, 30));
    }
    if (typeof p.model === "string") {
      sets.push("model = ?");
      params.push(clip(p.model, 60));
    }
    if (ts < (existing?.started_at ?? ts)) {
      sets.push("started_at = ?");
      params.push(ts);
    }
    params.push(p.session_id);
    this.store.run(`UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`, params);
    return { accepted: true, sessionId: p.session_id };
  }
}

export type { Checklist };

/**
 * Checklist updates from what Claude itself wrote: TodoWrite (whole list), TaskCreate/TaskUpdate tools and the
 * TaskCreated/TaskCompleted hooks (one item at a time). Returns undefined when the event doesn't touch the list.
 */
export function nextChecklist(prev: Checklist | null, p: RawHookPayload, ts: number): Checklist | null | undefined {
  const ti = (p.tool_input ?? {}) as Record<string, unknown>;
  const st = (v: unknown): Checklist["items"][number]["status"] => (v === "completed" || v === "done" ? "completed" : v === "in_progress" ? "in_progress" : "pending");
  const title = (o: Record<string, unknown>) => clip(str(o.content) ?? str(o.subject) ?? str(o.title) ?? str(o.description) ?? str(o.task_subject) ?? "", 120);
  let items: Checklist["items"] | null = null;
  let active: string | null = null;
  if (p.hook_event_name === "PreToolUse" && p.tool_name === "TodoWrite" && Array.isArray(ti.todos)) {
    const todos = (ti.todos as unknown[]).filter((t): t is Record<string, unknown> => !!t && typeof t === "object").slice(0, 100);
    items = todos.map((t) => ({ title: title(t), status: st(t.status) })).filter((t) => t.title);
    const cur = todos.find((t) => t.status === "in_progress");
    active = cur ? clip(str(cur.activeForm) ?? title(cur), 120) : null;
  } else if (p.hook_event_name === "PreToolUse" && (p.tool_name === "TaskCreate" || p.tool_name === "TaskUpdate")) {
    items = [...(prev?.items ?? [])];
    const id = str(ti.taskId) ?? str(ti.task_id) ?? str(ti.id) ?? undefined;
    const i = id ? items.findIndex((x) => x.id === id) : -1;
    if (p.tool_name === "TaskCreate" && title(ti)) items.push({ id, title: title(ti), status: st(ti.status) });
    else if (i >= 0) items[i] = { ...items[i]!, status: ti.status !== undefined ? st(ti.status) : items[i]!.status, title: title(ti) || items[i]!.title };
    else return undefined;
    if (ti.status === "in_progress") active = clip(str(ti.activeForm) ?? title(ti) ?? "", 120) || null;
  } else if (p.hook_event_name === "TaskCreated" || p.hook_event_name === "TaskCompleted") {
    const o = p as unknown as Record<string, unknown>;
    const t = title(o);
    const id = str(o.task_id) ?? str(o.taskId) ?? undefined;
    if (!t && !id) return undefined;
    items = [...(prev?.items ?? [])];
    const i = items.findIndex((x) => (id && x.id === id) || (!!t && x.title === t));
    const status = p.hook_event_name === "TaskCompleted" ? "completed" : "pending";
    if (i >= 0) items[i] = { ...items[i]!, status: p.hook_event_name === "TaskCompleted" ? "completed" : items[i]!.status };
    else if (t) items.push({ id, title: t, status });
  } else return undefined;
  if (!items.length) return null;
  const cur = active ?? items.find((x) => x.status === "in_progress")?.title ?? (prev && !active ? prev.current : null);
  const done = items.filter((x) => x.status === "completed").length;
  return { done, total: items.length, current: done === items.length ? null : cur, items: items.slice(0, 100), updatedAt: ts };
}

/**
 * Drains the spool directory written by hook.sh. Each file = one event. Files are deleted after ingestion;
 * malformed ones are moved to spool/rejected (kept small, for diagnostics) rather than retried forever.
 */
export class SpoolReader {
  private watcher: fs.FSWatcher | null = null;
  private poll: NodeJS.Timeout | null = null;
  private draining = false;
  private lastBeat = 0;
  stats = { accepted: 0, duplicates: 0, rejected: 0, lastEventAt: 0 };

  constructor(
    private readonly dir: string,
    private readonly ingestor: Ingestor,
    private readonly onIngest: (count: number) => void,
  ) {}

  start(): void {
    fs.mkdirSync(path.join(this.dir, "tmp"), { recursive: true, mode: 0o700 });
    this.drain();
    try {
      // Only new event files wake us. Our own heartbeat (.alive) and half-written files (tmp/) are ignored,
      // and bursts are batched, otherwise every drain would trigger the next one.
      this.watcher = fs.watch(this.dir, (_e, name) => {
        const n = name ? String(name) : "";
        if (n && !n.endsWith(".json")) return;
        this.schedule();
      });
    } catch {
      /* fs.watch unsupported: polling below still works */
    }
    this.poll = setInterval(() => this.drain(), 3000);
  }

  private pending: NodeJS.Timeout | null = null;
  private schedule(): void {
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      this.drain();
    }, DRAIN_BATCH_MS);
  }

  stop(): void {
    if (this.pending) clearTimeout(this.pending);
    this.pending = null;
    this.watcher?.close();
    this.watcher = null;
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
  }

  /** Synchronous so ordering is deterministic. Returns number of accepted events. */
  drain(limit = 2000): number {
    if (this.draining) return 0;
    this.draining = true;
    let accepted = 0;
    // Heartbeat: hooks stop writing if no reader has touched this for 2 days (e.g. BuildPilot removed, hooks left).
    // Touched at most once a minute.
    if (Date.now() - this.lastBeat > 60_000) {
      this.lastBeat = Date.now();
      try {
        fs.writeFileSync(path.join(this.dir, ".alive"), "");
      } catch {
        /* read-only: hooks fall back to writing */
      }
    }
    try {
      let files: { name: string; mtime: number }[];
      try {
        files = fs
          .readdirSync(this.dir)
          .filter((f) => f.endsWith(".json"))
          .map((name) => {
            try {
              return { name, mtime: fs.statSync(path.join(this.dir, name)).mtimeMs };
            } catch {
              return { name, mtime: 0 };
            }
          })
          .sort((a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name))
          .slice(0, limit);
      } catch {
        return 0;
      }
      for (const f of files) {
        const full = path.join(this.dir, f.name);
        let raw: string;
        try {
          raw = fs.readFileSync(full, "utf8");
        } catch {
          continue;
        }
        const r = this.ingestor.ingestRaw(raw, Math.round(f.mtime) || Date.now());
        if (r.accepted) {
          accepted++;
          this.stats.accepted++;
          this.stats.lastEventAt = Date.now();
          safeUnlink(full);
        } else if (r.duplicate) {
          this.stats.duplicates++;
          safeUnlink(full);
        } else {
          this.stats.rejected++;
          const rej = path.join(this.dir, "rejected");
          try {
            fs.mkdirSync(rej, { recursive: true, mode: 0o700 });
            const kept = fs.readdirSync(rej);
            if (kept.length < 50) fs.renameSync(full, path.join(rej, f.name));
            else safeUnlink(full);
          } catch {
            safeUnlink(full);
          }
        }
      }
    } finally {
      this.draining = false;
    }
    if (accepted > 0) this.onIngest(accepted);
    return accepted;
  }
}

function safeUnlink(p: string): void {
  try {
    fs.unlinkSync(p);
  } catch {
    /* already gone */
  }
}

export function rowToSession(r: Record<string, unknown>): Session {
  return {
    id: String(r.id),
    projectId: (r.project_id as string | null) ?? null,
    cwd: String(r.cwd ?? ""),
    transcriptPath: (r.transcript_path as string | null) ?? null,
    status: r.status as SessionStatus,
    statusReason: String(r.status_reason ?? ""),
    currentTask: (() => {
      if (r.current_task == null) return null;
      const t = cleanPrompt(String(r.current_task)); // also cleans rows stored before this existed
      return isSystemPrompt(t) ? null : t;
    })(),
    model: (r.model as string | null) ?? null,
    permissionMode: (r.permission_mode as string | null) ?? null,
    startedAt: Number(r.started_at),
    lastEventAt: Number(r.last_event_at),
    endedAt: r.ended_at == null ? null : Number(r.ended_at),
    eventCount: Number(r.event_count ?? 0),
    errorCount: Number(r.error_count ?? 0),
    checklist: (() => {
      if (r.checklist == null) return null;
      try {
        return JSON.parse(String(r.checklist)) as Checklist;
      } catch {
        return null;
      }
    })(),
  };
}

export function rowToEvent(r: Record<string, unknown>): HookEvent {
  return {
    id: Number(r.id),
    sessionId: String(r.session_id),
    hookEvent: String(r.hook_event),
    ts: Number(r.ts),
    toolName: (r.tool_name as string | null) ?? null,
    toolUseId: (r.tool_use_id as string | null) ?? null,
    summary: String(r.summary),
    filePath: (r.file_path as string | null) ?? null,
    isError: Number(r.is_error) === 1,
    errorText: (r.error_text as string | null) ?? null,
    agentId: (r.agent_id as string | null) ?? null,
    fingerprint: String(r.fingerprint),
  };
}
