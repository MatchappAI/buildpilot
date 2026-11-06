import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Claude Code hook installation.
 *
 * Design (docs/DECISIONS.md, D-002): hooks are `async` command hooks that copy the JSON payload Claude Code
 * writes to stdin into a private spool directory, then exit 0 with no output. They never block or slow
 * Claude Code, never inject context, need no network port, and still capture events while VS Code is closed.
 */

export const HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "Notification",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
] as const;

export const HOOK_SCRIPT = `#!/bin/sh
# BuildPilot hook (installed by the BuildPilot VS Code extension).
# Copies the event JSON that Claude Code sends on stdin into a private local spool.
# It never blocks Claude Code, never prints anything, and does nothing if BuildPilot was removed.
d="\${BUILDPILOT_HOME:-$HOME/.buildpilot}/spool"
[ -d "$d/tmp" ] || exit 0
[ -n "$(find "$d/.alive" -mmin +2880 2>/dev/null)" ] && exit 0
t=$(mktemp "$d/tmp/evt.XXXXXX" 2>/dev/null) || exit 0
head -c 1048576 > "$t"
mv "$t" "$d/$(basename "$t").json" 2>/dev/null || rm -f "$t"
exit 0
`;

export function buildpilotHome(): string {
  return process.env.BUILDPILOT_HOME || path.join(os.homedir(), ".buildpilot");
}

export function claudeSettingsPath(scope: "user" | "project", projectRoot?: string): string {
  if (scope === "project") {
    if (!projectRoot) throw new Error("projectRoot required for project scope");
    return path.join(projectRoot, ".claude", "settings.local.json");
  }
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  return path.join(base, "settings.json");
}

const MARKER = ".buildpilot/hook.sh";

function hookCommand(home: string): string {
  return `sh "${path.join(home, "hook.sh")}"`;
}

function isOurs(h: unknown, home: string): boolean {
  if (typeof h !== "object" || h === null) return false;
  const c = (h as { command?: unknown }).command;
  return typeof c === "string" && (c === hookCommand(home) || c.includes(MARKER));
}

export interface HookStatus {
  installed: boolean;
  missingEvents: string[];
  settingsPath: string;
  scriptPresent: boolean;
  settingsError: string | null;
}

type Json = Record<string, unknown>;

function readSettings(file: string): { data: Json; error: string | null } {
  if (!fs.existsSync(file)) return { data: {}, error: null };
  const raw = fs.readFileSync(file, "utf8");
  if (raw.trim() === "") return { data: {}, error: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { data: {}, error: "settings file is not a JSON object" };
    }
    return { data: parsed as Json, error: null };
  } catch (e) {
    return { data: {}, error: `settings file is not valid JSON (${(e as Error).message})` };
  }
}

/** Exactly what Connect adds to Claude Code's settings (shown before the user agrees). */
export function connectPreview(home = buildpilotHome()): string {
  const hooks: Record<string, unknown> = {};
  for (const ev of HOOK_EVENTS) hooks[ev] = [{ hooks: [{ type: "command", command: hookCommand(home), async: true, timeout: 10 }] }];
  return JSON.stringify({ hooks, statusLine: { type: "command", command: `sh "${path.join(home, "statusline.sh")}"` } }, null, 2);
}

export function hookStatus(settingsFile: string, home = buildpilotHome()): HookStatus {
  const { data, error } = readSettings(settingsFile);
  const hooks = (data.hooks ?? {}) as Record<string, unknown>;
  const missing = HOOK_EVENTS.filter((ev) => {
    const groups = hooks[ev];
    if (!Array.isArray(groups)) return true;
    return !groups.some((g) => Array.isArray((g as Json)?.hooks) && ((g as Json).hooks as unknown[]).some((h) => isOurs(h, home)));
  });
  return {
    installed: missing.length === 0 && !error,
    missingEvents: [...missing],
    settingsPath: settingsFile,
    scriptPresent: fs.existsSync(path.join(home, "hook.sh")),
    settingsError: error,
  };
}

export function ensureHome(home = buildpilotHome()): void {
  fs.mkdirSync(path.join(home, "spool", "tmp"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(home, "backups"), { recursive: true, mode: 0o700 });
  const script = path.join(home, "hook.sh");
  if (!fs.existsSync(script) || fs.readFileSync(script, "utf8") !== HOOK_SCRIPT) {
    fs.writeFileSync(script, HOOK_SCRIPT, { mode: 0o700 });
  }
}

/**
 * Merge BuildPilot hooks into a Claude Code settings file.
 * - Refuses to touch a file that isn't valid JSON (never corrupt user config).
 * - Writes a timestamped backup first.
 * - Preserves every existing key and every existing hook.
 * - Idempotent.
 */
export function installHooks(settingsFile: string, home = buildpilotHome()): { changed: boolean; backup: string | null } {
  ensureHome(home);
  const { data, error } = readSettings(settingsFile);
  if (error) throw new Error(`Not changing ${settingsFile}: ${error}. Fix the file or install hooks manually.`);
  const hooks = (typeof data.hooks === "object" && data.hooks !== null ? data.hooks : {}) as Record<string, unknown>;
  let changed = false;
  for (const ev of HOOK_EVENTS) {
    const groups = Array.isArray(hooks[ev]) ? (hooks[ev] as unknown[]) : [];
    const has = groups.some((g) => Array.isArray((g as Json)?.hooks) && ((g as Json).hooks as unknown[]).some((h) => isOurs(h, home)));
    if (!has) {
      groups.push({ hooks: [{ type: "command", command: hookCommand(home), async: true, timeout: 10 }] });
      changed = true;
    }
    hooks[ev] = groups;
  }
  if (!changed) return { changed: false, backup: null };
  data.hooks = hooks;
  const backup = writeWithBackup(settingsFile, data, home);
  return { changed: true, backup };
}

export function uninstallHooks(settingsFile: string, home = buildpilotHome()): { changed: boolean; backup: string | null } {
  const { data, error } = readSettings(settingsFile);
  if (error) throw new Error(`Not changing ${settingsFile}: ${error}.`);
  if (typeof data.hooks !== "object" || data.hooks === null) return { changed: false, backup: null };
  const hooks = data.hooks as Record<string, unknown>;
  let changed = false;
  for (const ev of Object.keys(hooks)) {
    const groups = hooks[ev];
    if (!Array.isArray(groups)) continue;
    const next: unknown[] = [];
    for (const g of groups) {
      const inner = (g as Json)?.hooks;
      if (!Array.isArray(inner)) {
        next.push(g);
        continue;
      }
      const kept = inner.filter((h) => !isOurs(h, home));
      if (kept.length !== inner.length) changed = true;
      if (kept.length > 0) next.push({ ...(g as Json), hooks: kept });
    }
    if (next.length > 0) hooks[ev] = next;
    else delete hooks[ev];
  }
  if (!changed) return { changed: false, backup: null };
  if (Object.keys(hooks).length === 0) delete data.hooks;
  const backup = writeWithBackup(settingsFile, data, home);
  return { changed: true, backup };
}

function writeWithBackup(file: string, data: Json, home: string): string | null {
  let backup: string | null = null;
  if (fs.existsSync(file)) {
    backup = path.join(home, "backups", `${path.basename(file)}.${Date.now()}.bak`);
    fs.mkdirSync(path.dirname(backup), { recursive: true, mode: 0o700 });
    fs.copyFileSync(file, backup);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.buildpilot.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, file);
  return backup;
}

// ---------------------------------------------------------------------------
// Statusline integration (documented: https://code.claude.com/docs/en/statusline)
// Claude Code pipes session JSON (incl. context_window.used_percentage, cost.total_cost_usd, rate_limits)
// to the statusLine command. Our script saves it per session for BuildPilot, then either runs the user's
// ORIGINAL statusline command (chained, so their display is unchanged) or prints a compact default line.
// ---------------------------------------------------------------------------

export const STATUSLINE_SCRIPT = `#!/bin/sh
# BuildPilot statusline (installed by BuildPilot). Saves Claude Code's status JSON locally, then
# runs your original statusline command if you had one, otherwise prints a short context line.
h="\${BUILDPILOT_HOME:-$HOME/.buildpilot}"
input=$(cat)
if [ -d "$h/status" ]; then
  sid=$(printf '%s' "$input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\\([A-Za-z0-9._:-]*\\)".*/\\1/p' | head -n 1)
  if [ -n "$sid" ]; then
    t="$h/status/.$sid.tmp.$$"
    printf '%s' "$input" > "$t" && mv "$t" "$h/status/$sid.json"
  fi
fi
if [ -s "$h/statusline-original" ]; then
  printf '%s' "$input" | sh -c "$(cat "$h/statusline-original")"
  exit 0
fi
cw=$(printf '%s' "$input" | tr -d '\\n' | grep -o '"context_window"[[:space:]]*:[[:space:]]*{[^}]*' | head -n 1)
pct=$(printf '%s' "$cw" | sed -n 's/.*"used_percentage"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p')
model=$(printf '%s' "$input" | sed -n 's/.*"display_name"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -n 1)
printf '%s' "\${model:-Claude}"
[ -n "$pct" ] && printf ' · context %s%%' "$pct"
printf ' · BuildPilot\\n'
`;

const STATUS_MARKER = "buildpilot/statusline.sh";

export interface StatuslineStatus {
  installed: boolean;
  chainedOriginal: string | null;
  otherStatusline: string | null; // someone else's statusline currently configured
}

export function statuslineStatus(settingsFile: string, home = buildpilotHome()): StatuslineStatus {
  const { data } = readSettings(settingsFile);
  const sl = data.statusLine as { command?: unknown } | undefined;
  const cmd = typeof sl?.command === "string" ? sl.command : null;
  const ours = !!cmd && (cmd.includes(STATUS_MARKER) || cmd.includes(path.join(home, "statusline.sh")));
  let orig: string | null = null;
  try {
    orig = fs.readFileSync(path.join(home, "statusline-original"), "utf8").trim() || null;
  } catch {
    /* none */
  }
  return { installed: ours, chainedOriginal: ours ? orig : null, otherStatusline: ours ? null : cmd };
}

/** Install the statusline. An existing statusline is preserved by chaining it (its output is still what you see). */
export function installStatusline(settingsFile: string, home = buildpilotHome()): { changed: boolean; backup: string | null; chained: string | null } {
  ensureHome(home);
  fs.mkdirSync(path.join(home, "status"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(home, "statusline.sh"), STATUSLINE_SCRIPT, { mode: 0o700 });
  const { data, error } = readSettings(settingsFile);
  if (error) throw new Error(`Not changing ${settingsFile}: ${error}.`);
  const current = data.statusLine as Record<string, unknown> | undefined;
  const cmd = typeof current?.command === "string" ? current.command : null;
  if (cmd && (cmd.includes(STATUS_MARKER) || cmd.includes(path.join(home, "statusline.sh")))) return { changed: false, backup: null, chained: statuslineStatus(settingsFile, home).chainedOriginal };
  let chained: string | null = null;
  if (cmd) {
    chained = cmd;
    fs.writeFileSync(path.join(home, "statusline-original"), cmd, { mode: 0o600 });
    fs.writeFileSync(path.join(home, "statusline-original.json"), JSON.stringify(current), { mode: 0o600 });
  } else {
    fs.rmSync(path.join(home, "statusline-original"), { force: true });
    fs.rmSync(path.join(home, "statusline-original.json"), { force: true });
  }
  data.statusLine = { ...(current ?? {}), type: "command", command: `sh "${path.join(home, "statusline.sh")}"` };
  const backup = writeWithBackup(settingsFile, data, home);
  return { changed: true, backup, chained };
}

/** Restore exactly what was there before (the user's original statusLine object, or nothing). */
export function uninstallStatusline(settingsFile: string, home = buildpilotHome()): { changed: boolean; backup: string | null } {
  const st = statuslineStatus(settingsFile, home);
  if (!st.installed) return { changed: false, backup: null };
  const { data, error } = readSettings(settingsFile);
  if (error) throw new Error(`Not changing ${settingsFile}: ${error}.`);
  let original: unknown = null;
  try {
    original = JSON.parse(fs.readFileSync(path.join(home, "statusline-original.json"), "utf8"));
  } catch {
    original = null;
  }
  if (original) data.statusLine = original;
  else delete data.statusLine;
  const backup = writeWithBackup(settingsFile, data, home);
  fs.rmSync(path.join(home, "statusline-original"), { force: true });
  fs.rmSync(path.join(home, "statusline-original.json"), { force: true });
  return { changed: true, backup };
}

export interface LiveStatus {
  sessionId: string;
  updatedAt: number;
  contextPct: number | null;
  contextSize: number | null;
  contextTokens: number | null;
  costUsd: number | null; // Claude Code's client-side estimate at list price
  model: string | null;
  fiveHourPct: number | null;
  sevenDayPct: number | null;
  /** Epoch ms when each window resets (null = unknown). Present only on Claude plan (subscription) sessions. */
  fiveHourResetsAt: number | null;
  sevenDayResetsAt: number | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** resets_at arrives as epoch seconds (or an ISO string); normalize to ms. */
const epochMs = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string") { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  return null;
};

export function readLiveStatus(sessionId: string, home = buildpilotHome()): LiveStatus | null {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(sessionId)) return null;
  const f = path.join(home, "status", `${sessionId}.json`);
  try {
    const st = fs.statSync(f);
    if (st.size > 512 * 1024) return null;
    const d = JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, Record<string, unknown> | undefined>;
    const cw = d.context_window ?? {};
    const rl = (d.rate_limits ?? {}) as Record<string, Record<string, unknown> | undefined>;
    return {
      sessionId,
      updatedAt: st.mtimeMs,
      contextPct: num(cw.used_percentage),
      contextSize: num(cw.context_window_size),
      contextTokens: num(cw.total_input_tokens),
      costUsd: num(d.cost?.total_cost_usd),
      model: typeof d.model?.display_name === "string" ? (d.model.display_name as string).slice(0, 60) : typeof d.model?.id === "string" ? (d.model.id as string).slice(0, 60) : null,
      fiveHourPct: num(rl.five_hour?.used_percentage),
      sevenDayPct: num(rl.seven_day?.used_percentage),
      fiveHourResetsAt: epochMs(rl.five_hour?.resets_at),
      sevenDayResetsAt: epochMs(rl.seven_day?.resets_at),
    };
  } catch {
    return null;
  }
}
