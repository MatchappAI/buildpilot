import * as fs from "fs";
import * as path from "path";
import { usesWal } from "./db";
import { buildpilotHome, claudeSettingsPath, ensureHome, HOOK_SCRIPT, hookStatus, installHooks, pluginConnected, statuslineStatus } from "./hooks";

/**
 * `bp doctor`: is BuildPilot itself set up right? Plain findings, each with what to do. `--fix` repairs only the safe
 * things (refresh BuildPilot's own files, subscribe newer events on an existing install, clear stale state).
 */
export interface Finding { ok: boolean; text: string; fix?: string }

export async function selfCheck(opts: { fix?: boolean; home?: string; settingsFile?: string; now?: number } = {}): Promise<{ findings: Finding[]; fixed: string[] }> {
  const home = opts.home ?? buildpilotHome();
  const settings = opts.settingsFile ?? claudeSettingsPath("user");
  const now = opts.now ?? Date.now();
  const f: Finding[] = [];
  const fixed: string[] = [];

  // Node and storage
  const [maj, min] = process.versions.node.split(".").map(Number) as [number, number];
  const nodeOk = maj > 22 || (maj === 22 && min >= 13);
  f.push(nodeOk ? { ok: true, text: `Node.js ${process.versions.node}` } : { ok: false, text: `Node.js ${process.versions.node} is older than 22.13, so BuildPilot can only read (not record) when other BuildPilot windows are open`, fix: "Update Node.js from https://nodejs.org" });
  const db = path.join(home, "buildpilot.db");
  if (fs.existsSync(db)) {
    // A read-only look: no migrations, no journal-mode change, never moves the file aside.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (f: string, o?: Record<string, unknown>) => { prepare(q: string): { get(): Record<string, unknown> }; close(): void } };
      const d = new DatabaseSync(db, { readOnly: true });
      const n = Number(d.prepare("SELECT COUNT(*) AS n FROM sessions").get().n ?? 0);
      const ok = String(d.prepare("PRAGMA quick_check").get().quick_check ?? "") === "ok";
      d.close();
      f.push(ok ? { ok: true, text: `Database OK (${usesWal(db) ? "shared safely, " : ""}${n} sessions, ${Math.round(fs.statSync(db).size / 1024 / 1024)} MB)` } : { ok: false, text: "The database reports damage", fix: "Close BuildPilot windows and run bp doctor again; BuildPilot keeps a damaged file aside and starts fresh on next open" });
    } catch (e) {
      const msg = (e as Error).message;
      f.push(/node:sqlite|Cannot find module|No such built-in/i.test(msg) ? { ok: true, text: "Database present (this Node.js can't inspect it; update to 22.13+ for a full check)" } : { ok: false, text: `Database can't be read: ${msg}`, fix: "Close other BuildPilot windows and run bp doctor again" });
    }
  } else f.push({ ok: true, text: "No database yet (it's created on first use)" });

  // Connection: plugin and/or settings hooks
  const plugin = pluginConnected(settings);
  const hs = hookStatus(settings, home);
  if (plugin && hs.installed) f.push({ ok: false, text: "Connected twice (plugin + older settings hooks), so every step is recorded twice", fix: "bp hooks uninstall (the plugin keeps working)" });
  else if (plugin) f.push({ ok: true, text: "Connected through the Claude Code plugin" });
  else if (hs.installed) {
    f.push({ ok: true, text: "Connected through ~/.claude/settings.json hooks" });
    if (hs.outdated) {
      if (opts.fix) {
        installHooks(settings, home);
        fixed.push("Subscribed the newer events (Claude's checklist progress, compaction end)");
      } else f.push({ ok: false, text: "An older connection: Claude's checklist progress isn't tracked yet", fix: "bp doctor --fix" });
    }
  } else f.push({ ok: false, text: "Not connected: BuildPilot can't see your sessions", fix: "In Claude Code: /plugin install buildpilot@buildpilot, or in a terminal: bp hooks install" });
  if (hs.settingsError) f.push({ ok: false, text: `Your Claude settings file isn't valid JSON (${hs.settingsError}); BuildPilot won't touch it`, fix: "Fix ~/.claude/settings.json, then run bp doctor again" });

  // Hook script freshness (settings-hook installs run ~/.buildpilot/hook.sh)
  if (hs.installed) {
    const script = path.join(home, "hook.sh");
    if (!fs.existsSync(script)) {
      if (opts.fix) { ensureHome(home); fixed.push("Restored BuildPilot's hook script"); } else f.push({ ok: false, text: "BuildPilot's hook script is missing, so nothing is recorded", fix: "bp doctor --fix" });
    } else if (fs.readFileSync(script, "utf8") !== HOOK_SCRIPT) {
      if (opts.fix) { ensureHome(home); fixed.push("Updated BuildPilot's hook script to this version"); } else f.push({ ok: false, text: "BuildPilot's hook script is from an older version", fix: "bp doctor --fix" });
    }
  }

  // Status line (exact chat % and plan limits)
  const sl = statuslineStatus(settings, home);
  f.push(sl.installed ? { ok: true, text: "Status-line reporter on (exact chat % full and plan limits)" } : { ok: false, text: "Chat % full and plan limits are unknown until the status-line reporter is on", fix: "bp statusline install (your own status line keeps working)" });

  // Spool health
  const spool = path.join(home, "spool");
  const backlog = fs.existsSync(spool) ? fs.readdirSync(spool).filter((x) => x.endsWith(".json")).length : 0;
  if (backlog > 500) f.push({ ok: false, text: `${backlog} events are waiting to be read (no BuildPilot window has been open)`, fix: "Open bp ui (or run bp) once; they're read in seconds" });
  const alive = path.join(spool, ".alive");
  if (fs.existsSync(alive) && now - fs.statSync(alive).mtimeMs > 2 * 86400_000) {
    if (opts.fix) { fs.writeFileSync(alive, ""); fixed.push("Restarted recording (nothing had read events for 2+ days, so hooks had paused)"); } else f.push({ ok: false, text: "Recording is paused: nothing read BuildPilot's events for 2+ days", fix: "bp doctor --fix (or open bp ui)" });
  }
  const rejected = path.join(spool, "rejected");
  const nRej = fs.existsSync(rejected) ? fs.readdirSync(rejected).length : 0;
  if (nRej) f.push({ ok: true, text: `${nRej} unreadable event${nRej === 1 ? "" : "s"} kept for diagnosis in ${rejected}` });

  // Window server state
  const info = path.join(home, "ui-server.json");
  if (fs.existsSync(info)) {
    try {
      const j = JSON.parse(fs.readFileSync(info, "utf8")) as { pid: number };
      process.kill(j.pid, 0);
      f.push({ ok: true, text: "BuildPilot window server is running" });
    } catch {
      if (opts.fix) { fs.rmSync(info, { force: true }); fixed.push("Cleared a stale window-server record"); }
    }
  }
  return { findings: f, fixed };
}
