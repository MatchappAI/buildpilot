import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { WidgetSession } from "./glance";
import { folderLabel, oneLine } from "./glance";

/**
 * Codex sessions, read-only, from Codex's own logs (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl).
 * No hooks exist for Codex, so there are no approvals here; we show what the log proves: working/idle,
 * your last message, tokens, rate limits when Codex reports them, and errors (e.g. "usage limit").
 */
export interface CodexLimits { primaryPct: number | null; secondaryPct: number | null; resetsAt: number | null }
export interface CodexSession extends WidgetSession { tokens: number | null; contextWindow: number | null; limits: CodexLimits | null; error: string | null }

export const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), ".codex");

function tail(file: string, bytes: number): string {
  const st = fs.statSync(file);
  const fd = fs.openSync(file, "r");
  try {
    const n = Math.min(bytes, st.size);
    const b = Buffer.alloc(n);
    fs.readSync(fd, b, 0, n, st.size - n);
    return b.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function head(file: string, bytes: number): string {
  const fd = fs.openSync(file, "r");
  try {
    const b = Buffer.alloc(bytes);
    const n = fs.readSync(fd, b, 0, bytes, 0);
    return b.subarray(0, n).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

/** Plain description of a Codex tool call, e.g. "Running npm test", "Using web". */
export function codexAction(p: Record<string, unknown>): string {
  const name = String(p.name ?? p.type ?? "tool");
  let args: Record<string, unknown> = {};
  try { args = typeof p.arguments === "string" ? JSON.parse(p.arguments) : (p.arguments as Record<string, unknown>) ?? {}; } catch { /* not JSON */ }
  const cmd = Array.isArray(args.command) ? (args.command as string[]).join(" ") : typeof args.cmd === "string" ? args.cmd : typeof args.command === "string" ? args.command : null;
  if (cmd) return `Running ${cmd.replace(/^bash -lc /, "").replace(/\s+/g, " ").slice(0, 60)}`;
  if (name === "apply_patch" || /patch/.test(name)) return "Editing files";
  if (typeof p.input === "string" && name === "exec") return "Running a script";
  return `Using ${p.namespace ? `${String(p.namespace)} ` : ""}${name}`.slice(0, 60);
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function parseRollout(head: string, body: string, mtime: number, now: number): CodexSession | null {
  const objs = (t: string) => t.split("\n").filter((l) => l.startsWith("{")).map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } }).filter(Boolean) as Record<string, unknown>[];
  const meta = objs(head).find((o) => o.type === "session_meta")?.payload as Record<string, unknown> | undefined;
  if (!meta || typeof meta.cwd !== "string") return null;
  const id = String(meta.id ?? meta.session_id ?? "");
  let started: number | null = null;
  let completed: number | null = null;
  let lastMsg: string | null = null;
  let tokens: number | null = null;
  let contextWindow: number | null = null;
  let limits: CodexLimits | null = null;
  let error: string | null = null;
  let lastTs = mtime;
  const calls = new Map<string, { ts: number; text: string }>();
  const done = new Set<string>();
  const timeline: { ts: number; text: string; error: boolean }[] = [];
  for (const o of objs(body)) {
    const p = (o.payload ?? {}) as Record<string, unknown>;
    const ts = typeof o.timestamp === "string" ? Date.parse(o.timestamp) : NaN;
    if (Number.isFinite(ts)) lastTs = ts;
    if (o.type === "response_item" && (p.type === "function_call" || p.type === "custom_tool_call" || p.type === "local_shell_call")) {
      const id = String(p.call_id ?? p.id ?? "");
      const text = codexAction(p);
      calls.set(id, { ts: Number.isFinite(ts) ? ts : lastTs, text });
      timeline.push({ ts: Number.isFinite(ts) ? ts : lastTs, text, error: false });
      continue;
    }
    if (o.type === "response_item" && (p.type === "function_call_output" || p.type === "custom_tool_call_output")) {
      done.add(String(p.call_id ?? ""));
      continue;
    }
    if (o.type !== "event_msg") continue;
    if (p.type === "task_started") { started = Number.isFinite(ts) ? ts : now; completed = null; error = null; contextWindow = num(p.model_context_window) ?? contextWindow; }
    if (p.type === "task_complete") {
      completed = Number.isFinite(ts) ? ts : now;
      const e = p.error as Record<string, unknown> | undefined;
      error = e && typeof e.message === "string" ? e.message : null;
    }
    if (p.type === "user_message" && typeof p.message === "string") lastMsg = p.message;
    if (p.type === "token_count") {
      const info = p.info as Record<string, unknown> | null;
      const tot = info?.total_token_usage as Record<string, unknown> | undefined;
      if (tot) tokens = num(tot.total_tokens) ?? ((num(tot.input_tokens) ?? 0) + (num(tot.output_tokens) ?? 0));
      contextWindow = num(info?.model_context_window) ?? contextWindow;
      const rl = p.rate_limits as Record<string, Record<string, unknown> | null> | undefined;
      if (rl && (rl.primary || rl.secondary)) {
        const resets = num(rl.primary?.resets_in_seconds) ?? num(rl.primary?.resets_at);
        limits = { primaryPct: num(rl.primary?.used_percent), secondaryPct: num(rl.secondary?.used_percent), resetsAt: resets == null ? null : resets > 1e9 ? resets * (resets < 1e12 ? 1000 : 1) : lastTs + resets * 1000 };
      }
    }
  }
  const working = started != null && completed == null && now - lastTs < 2 * 60_000;
  const pending = [...calls.entries()].reverse().find(([id]) => !done.has(id))?.[1];
  const failed = !!error;
  return {
    id: `codex-${id}`,
    folder: folderLabel(meta.cwd),
    cwd: meta.cwd,
    status: working ? "running" : failed ? "failed" : "idle",
    word: working ? "working" : failed ? "stopped with an error" : "idle",
    reason: error ? oneLine(error, 160) ?? "" : "",
    task: oneLine(lastMsg, 160),
    contextPct: null,
    lastEventAt: lastTs,
    needsYou: false,
    next: null,
    name: null,
    now: working ? (pending?.text ?? "Thinking") : null,
    nowSince: working ? (pending?.ts ?? started) : null,
    errors1h: error && now - lastTs < 3600_000 ? 1 : 0,
    lastErrors: error ? [oneLine(error, 160) ?? ""] : [],
    waitingFor: null,
    stopped: false,
    autoApprove: false,
    compactedAt: null,
    timeline: timeline.slice(-15).reverse(),
    agent: "codex",
    tokens,
    contextWindow,
    limits,
    error,
  };
}

/** Codex sessions active in the last `windowMs` (default 12 h), newest first. Empty if Codex isn't installed. */
export function codexSessions(now = Date.now(), windowMs = 12 * 3600_000, home = codexHome()): CodexSession[] {
  const root = path.join(home, "sessions");
  if (!fs.existsSync(root)) return [];
  const out: CodexSession[] = [];
  // Only look at the last 3 days' folders (rollouts are filed by start date).
  const days = [0, 1, 2].map((d) => new Date(now - d * 86400_000)).map((d) => path.join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")));
  for (const dir of days) {
    let files: string[] = [];
    try { files = fs.readdirSync(dir).filter((f) => f.startsWith("rollout-") && f.endsWith(".jsonl")); } catch { continue; }
    for (const f of files) {
      const file = path.join(dir, f);
      try {
        const st = fs.statSync(file);
        if (now - st.mtimeMs > windowMs) continue;
        const s = parseRollout(head(file, 64 * 1024), tail(file, 1024 * 1024), st.mtimeMs, now);
        if (s) out.push(s);
      } catch { /* unreadable: skip */ }
    }
  }
  return out.sort((a, b) => b.lastEventAt - a.lastEventAt).slice(0, 20);
}
