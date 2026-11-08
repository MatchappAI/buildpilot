import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";

/**
 * Find the terminal tab where a Claude session is running and bring it to the front (macOS: Terminal.app, iTerm2),
 * or switch tmux to it. Read-only process inspection with argument arrays only; the tty is validated before use.
 */
const run = (cmd: string, args: string[], timeout = 4000) => new Promise<string>((resolve) => execFile(cmd, args, { timeout }, (_e, out) => resolve(String(out ?? ""))));
const real = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

/** Parse `ps -axo pid=,tty=,comm=` output into claude processes with a terminal. Pure, for tests. */
export function claudeProcesses(ps: string): { pid: number; tty: string }[] {
  return ps.split("\n").map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 3 && /(^|\/)claude$/.test(p.slice(2).join(" ")) && p[1] !== "??" && /^[a-z0-9]+$/i.test(p[1]!)).map((p) => ({ pid: Number(p[0]), tty: p[1]! }));
}

/**
 * The /dev/ttysNNN of the claude process running in `cwd`, or null. When several claude processes share the folder,
 * `startedAt` (when the session last started or resumed) picks the one whose process started closest to it.
 */
export async function ttyForCwd(cwd: string, startedAt?: number | null): Promise<string | null> {
  if (process.platform !== "darwin" && process.platform !== "linux") return null;
  const want = real(cwd);
  const hits: { pid: number; tty: string }[] = [];
  for (const p of claudeProcesses(await run("ps", ["-axo", "pid=,tty=,comm="]))) {
    const out = await run("lsof", ["-a", "-p", String(p.pid), "-d", "cwd", "-Fn"]);
    const dir = out.split("\n").find((l) => l.startsWith("n"))?.slice(1);
    if (dir && real(dir) === want) hits.push(p);
  }
  if (!hits.length) return null;
  let pick = hits[0]!;
  if (hits.length > 1 && startedAt) {
    let best = Infinity;
    for (const h of hits) {
      const t = Date.parse((await run("ps", ["-o", "lstart=", "-p", String(h.pid)])).trim());
      const d = Number.isFinite(t) ? Math.abs(t - startedAt) : Infinity;
      if (d < best) { best = d; pick = h; }
    }
  }
  return `/dev/${pick.tty.startsWith("tty") ? pick.tty : `tty${pick.tty}`}`;
}

const TERMINAL = `on run argv
  set t to item 1 of argv
  tell application "Terminal"
    repeat with w in windows
      repeat with b in tabs of w
        if tty of b is t then
          set selected of b to true
          set index of w to 1
          activate
          return "ok"
        end if
      end repeat
    end repeat
  end tell
  return "no"
end run`;

const ITERM = `on run argv
  set t to item 1 of argv
  tell application "iTerm2"
    repeat with w in windows
      repeat with b in tabs of w
        repeat with s in sessions of b
          if tty of s is t then
            select w
            select b
            select s
            activate
            return "ok"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "no"
end run`;

/** Is this macOS app running? (pgrep -x doesn't match app bundles reliably; look at process paths.) */
const running = async (app: string) => (await run("ps", ["-axo", "comm="])).split("\n").some((l) => l.trim().endsWith(`/MacOS/${app}`) || l.trim() === app);

/** Bring the tab with this tty forward. Returns which app, or null if not found. */
export async function focusTty(tty: string): Promise<string | null> {
  if (process.platform !== "darwin" || !/^\/dev\/ttys?[0-9a-z]+$/i.test(tty)) return null;
  if (await running("Terminal")) if ((await run("osascript", ["-e", TERMINAL, tty])).trim() === "ok") return "Terminal";
  if (await running("iTerm2")) if ((await run("osascript", ["-e", ITERM, tty])).trim() === "ok") return "iTerm";
  return null;
}

/** tmux pane in this folder → switch to it. */
export async function focusTmux(cwd: string): Promise<boolean> {
  const panes = await run("tmux", ["list-panes", "-a", "-F", "#{session_name}:#{window_index}.#{pane_index}\t#{pane_current_path}"], 3000);
  const hit = panes.split("\n").map((l) => l.split("\t")).find(([, p]) => p && real(p) === real(cwd));
  if (!hit?.[0]) return false;
  await run("tmux", ["select-window", "-t", hit[0]]);
  await run("tmux", ["select-pane", "-t", hit[0]]);
  return true;
}

/** Best effort: tmux, then Terminal/iTerm tab by tty. Returns a short description of what happened. */
export async function findBuild(cwd: string, startedAt?: number | null): Promise<{ found: boolean; how: string }> {
  if (await focusTmux(cwd)) return { found: true, how: "tmux" };
  const tty = await ttyForCwd(cwd, startedAt);
  if (tty) {
    const app = await focusTty(tty);
    if (app) return { found: true, how: app };
    return { found: false, how: `It's running in a terminal (${tty.replace("/dev/", "")}) BuildPilot can't switch to, probably inside VS Code or Cursor.` };
  }
  return { found: false, how: `It's running in a terminal in ${cwd}.` };
}
