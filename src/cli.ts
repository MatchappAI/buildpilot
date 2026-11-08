/**
 * BuildPilot CLI: the same local engine without VS Code.
 *   node dist/cli.js brief [folder]          one-line spoken-style status
 *   node dist/cli.js status [folder]         stage, health, issues, next step
 *   node dist/cli.js sessions [folder]       observed Claude Code sessions
 *   node dist/cli.js handoff [folder]        context handoff for a new session
 *   node dist/cli.js prompt <goal> "<request>" [folder]
 *   node dist/cli.js hooks status|install|uninstall [--project <folder>]
 *   node dist/cli.js audit [folder]          dependency vulnerability check (npm audit / pip-audit)
 *   node dist/cli.js visual [folder] [url]   check the running app + screenshot
 *   node dist/cli.js statusline status|install|uninstall   exact context % from Claude Code
 *   node dist/cli.js serve [folder]          run the Integration API (token in ~/.buildpilot/api-token)
 */
import "./quiet";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { IntegrationApi, loadOrCreateToken } from "./core/api";
import { Engine } from "./core/engine";
import { buildpilotHome, claudeSettingsPath, hookStatus, installHooks, installStatusline, statuslineStatus, uninstallHooks, uninstallStatusline } from "./core/hooks";
import { folderLabel, glance, isYourTurn, oneLine, widgetData } from "./core/glance";
import { installWidget, pickRuntime, uninstallWidget, widgetStatus } from "./core/widget";
import { GOALS } from "./core/prompts";
import { gateParallel, paywallText, readLicense, saveLicense } from "./core/license";
import { worktrees } from "./core/git";
import { pageData, PageData } from "./core/page";
import { guessGoal } from "./core/goal";
import { openUri } from "./core/extId";
import { installShell, shellStatus, uninstallShell } from "./core/shell";
import { execFile } from "child_process";
import { GoalType } from "./core/types";

/** Set at build time (esbuild define) so a running window server can tell it's out of date. */
declare const __BP_VERSION__: string;
const CLI_VERSION = typeof __BP_VERSION__ === "string" ? __BP_VERSION__ : "dev";

const STATUS_PLAIN: Record<string, string> = { running: "Working", awaiting_approval: "Needs your OK", blocked: "Needs your answer", idle: "Your turn", completed: "Closed", failed: "Failed", unknown: "Quiet" };

function usage(msg: string): void {
  console.error(msg);
  process.exitCode = 2;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const [cmd = "status", ...rest] = args.filter((a) => a !== "--json");
  if (cmd === "glance") {
    // Fast path for new terminals: no project analysis, no tool probing.
    const engine = new Engine({ light: true });
    await engine.start();
    console.log(glance(engine, { cwd: process.cwd(), columns: process.stdout.columns ?? 80, color: !!process.stdout.isTTY && !process.env.NO_COLOR }));
    engine.stop();
    return;
  }
  if (cmd === "widget") {
    // JSON for the menu-bar widget: same fast path as glance (drains new hook events, no analysis).
    const engine = new Engine({ light: true });
    await engine.start();
    console.log(JSON.stringify(widgetData(engine)));
    engine.stop();
    return;
  }
  if (cmd === "bar") {
    const sub = rest[0] ?? "status";
    if (sub === "install") {
      const zip = path.join(__dirname, "..", "media", "widget", "BuildPilot-Bar.zip");
      const runtime = pickRuntime();
      if (!runtime) return usage("Node.js wasn't found. Install the widget from VS Code instead: BuildPilot → Connect → Menu-bar widget.");
      if (!fs.existsSync(zip)) return usage("Run this from the installed extension (the Desktop installer does it for you), or use VS Code: BuildPilot → Connect.");
      const r = installWidget({ zip, cliDir: __dirname, runtime, startAtLogin: !rest.includes("--no-login") });
      console.log(json ? JSON.stringify(r) : `BuildPilot Bar is in your menu bar (${r.appPath}).${rest.includes("--no-login") ? "" : " It starts when you log in."}`);
    } else if (sub === "uninstall") {
      const r = uninstallWidget();
      console.log(json ? JSON.stringify(r) : r.removed.length ? "BuildPilot Bar removed (moved to the Trash)." : "BuildPilot Bar wasn't installed.");
    } else if (sub === "status") {
      const st = widgetStatus();
      console.log(json ? JSON.stringify(st) : !st.supported ? "The menu-bar widget is macOS only." : st.installed ? `Installed (${st.appPath}), ${st.running ? "running" : "not running"}${st.startAtLogin ? ", starts at login" : ""}.` : "Not installed. Install: bp bar install");
    } else return usage(`Unknown option "${sub}". Use: bp bar status | install | uninstall`);
    return;
  }
  if (cmd === "ui") {
    // BuildPilot as its own window (no VS Code). One private server per user, reused across launches.
    const home = buildpilotHome();
    const info = path.join(home, "ui-server.json");
    const alive = (): { port: number; token: string; pid: number } | null => {
      try {
        const j = JSON.parse(fs.readFileSync(info, "utf8")) as { port: number; token: string; pid: number; version?: string };
        process.kill(j.pid, 0);
        // A server from an older BuildPilot keeps running old code: replace it so fixes take effect.
        if (j.version !== CLI_VERSION && rest[0] !== "--serve") {
          try { process.kill(j.pid, "SIGTERM"); } catch { /* gone */ }
          fs.rmSync(info, { force: true });
          return null;
        }
        return j;
      } catch {
        return null;
      }
    };
    if (rest[0] === "--serve") {
      const engine = new Engine();
      await engine.start();
      const folder = rest[1] && fs.existsSync(rest[1]) ? rest[1] : null;
      if (folder) await engine.openProject(folder);
      const { UiServer } = await import("./core/uiserver");
      const media = [path.join(__dirname, "..", "media"), path.join(home, "media")].find((d) => fs.existsSync(path.join(d, "webview.js")));
      if (!media) { console.error("BuildPilot's page files weren't found next to the CLI."); process.exit(1); }
      const srv = new UiServer(engine, { port: Number(process.env.BUILDPILOT_UI_PORT ?? 0), media, idleExitMs: 15 * 60_000 });
      await srv.start();
      const port = Number(new URL(srv.url).port);
      fs.writeFileSync(info, JSON.stringify({ port, token: srv.token, pid: process.pid, version: CLI_VERSION }), { mode: 0o600 });
      return; // keep running
    }
    let s = alive();
    if (!s) {
      const { spawn } = await import("child_process");
      const folder = rest[0] ? path.resolve(rest[0]) : "";
      const child = spawn(process.execPath, [__filename, "ui", "--serve", folder], { detached: true, stdio: "ignore" });
      child.unref();
      for (let i = 0; i < 50 && !(s = alive()); i++) await new Promise((r) => setTimeout(r, 100));
      if (!s) { console.error("BuildPilot couldn't start its window. Try: bp ui again."); process.exitCode = 1; return; }
    }
    // Ask the running server for a one-time launch code, so the long-lived token never appears in a URL,
    // the browser history or the process list.
    let url = "";
    for (let i = 0; i < 10 && !url; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${s.port}/api/launch`, { method: "POST", headers: { "x-bp-token": s.token } });
        if (r.ok) url = `http://127.0.0.1:${s.port}/?c=${((await r.json()) as { code: string }).code}`;
        else if (r.status === 404) break; // a server from before 0.12: restart it below
      } catch {
        await new Promise((res) => setTimeout(res, 200)); // still starting up
      }
    }
    if (!url) {
      try { process.kill(s.pid, "SIGTERM"); } catch { /* already gone */ }
      fs.rmSync(info, { force: true });
      console.error("BuildPilot's window server was out of date and has been stopped. Run bp ui again.");
      process.exitCode = 1;
      return;
    }
    if (rest.includes("--print")) { console.log(url); return; }
    const chrome = ["/Applications/Google Chrome.app", "/Applications/Microsoft Edge.app", "/Applications/Brave Browser.app"].find((p) => fs.existsSync(p));
    if (process.platform === "darwin" && chrome) execFile("open", ["-na", chrome, "--args", `--app=${url}`, "--window-size=780,1000"], () => {});
    else execFile(process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open", [url], () => {});
    console.log("BuildPilot is open.");
    return;
  }
  if (cmd === "recent") {
    // The project you were most recently building in (for the Desktop launcher). Prints a folder or nothing.
    const engine = new Engine({ light: true });
    await engine.start();
    const w = widgetData(engine);
    const gitRoot = (dir: string): string | null => {
      for (let d = path.resolve(dir); d !== path.dirname(d); d = path.dirname(d)) if (fs.existsSync(path.join(d, ".git"))) return d;
      return null;
    };
    let pick: string | null = null;
    for (const s of [...w.sessions].sort((a, b) => b.lastEventAt - a.lastEventAt)) {
      if (path.resolve(s.cwd) === os.homedir()) continue;
      pick = gitRoot(s.cwd) ?? (fs.existsSync(s.cwd) ? s.cwd : null);
      if (pick) break;
    }
    if (!pick) {
      const row = engine.store.get<{ root: string }>("SELECT root FROM projects ORDER BY COALESCE(last_analyzed_at, created_at) DESC LIMIT 1");
      if (row?.root && fs.existsSync(row.root)) pick = row.root;
    }
    engine.stop();
    if (pick) console.log(pick);
    return;
  }
  if (cmd === "open") {
    if (rest[0]?.startsWith("-")) return usage("Usage: bp open [folder]   opens BuildPilot in VS Code for that folder (default: this one)");
    const folder = path.resolve(rest[0] ?? process.cwd());
    const uri = openUri(folder);
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
    execFile(opener, [uri], (e) => {
      if (e) console.error(`Couldn't open VS Code: ${e.message}`);
    });
    console.log(`Opening BuildPilot for ${folder} in VS Code…`);
    return;
  }
  if (cmd === "shell") {
    const sub = rest[0] ?? "status";
    if (sub === "install") {
      const r = installShell(__dirname);
      console.log(r.changed.length ? `BuildPilot will now appear in every new terminal (${r.changed.join(", ")}). Open a new terminal to see it. Silence anytime: export BUILDPILOT_QUIET=1` : "Already set up.");
    } else if (sub === "uninstall") {
      const r = uninstallShell();
      console.log(r.changed.length ? `Removed from ${r.changed.join(", ")}.` : "Nothing to remove.");
    } else if (sub === "status") {
      const st = shellStatus();
      console.log(json ? JSON.stringify(st) : st.installed ? `On: BuildPilot appears in new terminals (${st.files.join(", ")}). Turn off: bp shell uninstall` : "Off. Turn on: bp shell install");
    } else return usage(`Unknown option "${sub}". Use: bp shell status | install | uninstall`);
    return;
  }
  if (cmd === "hooks") {
    const pi = rest.indexOf("--project");
    const file = pi >= 0 ? claudeSettingsPath("project", path.resolve(rest[pi + 1] ?? ".")) : claudeSettingsPath("user");
    const sub = rest[0] && !rest[0].startsWith("--") ? rest[0] : "status";
    if (sub === "install") {
      const r = installHooks(file);
      console.log(json ? JSON.stringify(r) : r.changed ? `Connected to Claude Code (${file}).${r.backup ? ` Backup: ${r.backup}` : ""}` : "Already connected.");
    } else if (sub === "uninstall") {
      const r = uninstallHooks(file);
      console.log(json ? JSON.stringify(r) : r.changed ? `Disconnected. Only BuildPilot's hooks were removed from ${file}.` : "Wasn't connected. Nothing changed.");
    } else if (sub === "status") {
      const st = hookStatus(file);
      console.log(json ? JSON.stringify(st) : st.settingsError ? `Problem reading ${file}: ${st.settingsError}` : st.installed ? `Connected (${file}).` : `Not connected${st.missingEvents.length && st.scriptPresent ? ` (missing ${st.missingEvents.length} events)` : ""}. Connect: bp hooks install`);
    } else return usage(`Unknown option "${sub}". Use: bp hooks status | install | uninstall [--project <folder>]`);
    return;
  }
  if (cmd === "statusline") {
    const file = claudeSettingsPath("user");
    const sub = rest[0] ?? "status";
    if (sub === "install") {
      const r = installStatusline(file);
      console.log(json ? JSON.stringify(r) : r.changed ? `Chat % full and plan limits on.${r.chained ? " Your own status line keeps showing." : ""} New or resumed Claude Code sessions will report them.` : "Already on.");
    } else if (sub === "uninstall") {
      const r = uninstallStatusline(file);
      console.log(json ? JSON.stringify(r) : r.changed ? "Status line restored to what you had before." : "Wasn't on. Nothing changed.");
    } else if (sub === "status") {
      const st = statuslineStatus(file);
      console.log(json ? JSON.stringify(st) : st.installed ? `On${st.chainedOriginal ? " (your own status line is preserved)" : ""}.` : st.otherStatusline ? "Off (you have your own status line; turning on keeps it)." : "Off. Turn on: bp statusline install");
    } else return usage(`Unknown option "${sub}". Use: bp statusline status | install | uninstall`);
    return;
  }
  if (cmd === "license") {
    const home = buildpilotHome();
    if (rest[0]) {
      const v = saveLicense(home, rest[0]);
      if (!v.valid) { process.exitCode = 1; return usage(`That key didn't work (${v.reason}). Nothing was saved.`); }
      console.log(`Pro unlocked${v.sub ? ` for ${v.sub}` : ""}. Unlimited prompts.`);
    } else {
      const l = readLicense(home);
      console.log(l.valid ? `Pro${l.sub ? ` (${l.sub})` : ""}. Unlimited prompts.` : "Free plan. Add a key: bp license <your-key>");
    }
    return;
  }
  if (cmd === "help" || cmd === "--help") {
    console.log(`BuildPilot: your Claude Code companion

Everyday
  bp glance                 every Claude session in three seconds
  bp today                  your day: needs you, your turn, check before you trust it, next step
  bp ui                     open BuildPilot in its own window
  bp limits                 sessions, chat % full, plan limits + forecast, tips
  bp go [name]              bring the session that needs you forward (Terminal/iTerm tab or tmux)
  bp who <file>             which Claude session changed a file, and when
  bp prompt auto "<what>"   turn plain words into an expert prompt

Side builds (another Claude in its own copy of the project)
  bp new "<name>"           start one (--no-env: don't copy .env files)
  bp builds                 list side builds
  bp review                 see what a side build changed
  bp merge <name>           bring a side build into your project
  bp done <name>            remove a finished side build (its branch is kept)

Setup
  bp doctor [--fix]         is BuildPilot set up right? (--fix repairs the safe things)
  bp statusline install     exact chat % full and plan limits (keeps your own status line)
  bp hooks install          let BuildPilot see your sessions (uninstall to undo)
  bp bar install            Mac menu-bar widget (with an optional floating panel)
  bp tmux                   one-line status for tmux/your prompt
  bp license [key]          show your plan, or unlock Pro with a key

More: bp (this folder) · sessions · brief · handoff · audit · visual [url]
      prompt <goal> "<what>" · open · bar · shell · serve   (add --json to setup commands)`);
    console.log(`\ngoals: ${GOALS.map((g) => g.id).join(", ")}`);
    return;
  }
  if (cmd === "tmux") {
    const engine = new Engine({ light: true });
    await engine.start();
    const p = pageData(engine, null);
    engine.stop();
    const L = p.limits;
    const bits = [`BP ${p.working}▶`];
    if (p.needs) bits.push(`${p.needs}!`);
    if (L.fiveHourPct != null) bits.push(`5h ${Math.round(L.fiveHourPct)}%`);
    if (L.fullAt) bits.push(`out ~${new Date(L.fullAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
    if (p.plan.sellable && p.plan.trialDaysLeft != null && p.plan.trialDaysLeft <= 3) bits.push(`trial ${p.plan.trialDaysLeft}d`);
    process.stdout.write(bits.join(" "));
    return;
  }
  if (cmd === "doctor") {
    const { selfCheck } = await import("./core/selfcheck");
    const r = await selfCheck({ fix: rest.includes("--fix") });
    if (rest.includes("--json")) { console.log(JSON.stringify(r)); return; }
    for (const x of r.findings) console.log(`${x.ok ? "✓" : "✗"} ${x.text}${!x.ok && x.fix ? `\n    → ${x.fix}` : ""}`);
    for (const x of r.fixed) console.log(`✓ Fixed: ${x}`);
    const bad = r.findings.filter((x) => !x.ok).length;
    console.log(bad ? `\n${bad} thing${bad === 1 ? "" : "s"} to fix.${rest.includes("--fix") ? "" : " Run bp doctor --fix for the safe ones."}` : "\nAll good.");
    return;
  }
  if (cmd === "today") {
    // Your day across every project: what needs you, what's working, what finished (and whether it was proven), risks, one next step.
    const engine = new Engine({ light: true });
    await engine.start();
    const w = widgetData(engine);
    const midnight = new Date().setHours(0, 0, 0, 0);
    // A finished turn = a Stop, or a session that ended after its last prompt without one (headless runs).
    const finished = engine.store.all<{ cwd: string; n: number }>(
      `SELECT s.cwd, COUNT(*) AS n FROM events e JOIN sessions s ON s.id = e.session_id
       WHERE e.ts >= ? AND e.agent_id IS NULL AND (e.hook_event = 'Stop' OR (e.hook_event = 'SessionEnd' AND NOT EXISTS (
         SELECT 1 FROM events x WHERE x.session_id = e.session_id AND x.hook_event = 'Stop' AND x.ts > COALESCE((SELECT MAX(p.ts) FROM events p WHERE p.session_id = e.session_id AND p.hook_event = 'UserPromptSubmit' AND p.ts <= e.ts), 0))
         AND EXISTS (SELECT 1 FROM events p WHERE p.session_id = e.session_id AND p.hook_event = 'UserPromptSubmit' AND p.ts <= e.ts)))
       GROUP BY s.cwd ORDER BY n DESC`,
      [midnight],
    );
    engine.stop();
    const name = (b: (typeof w.sessions)[number]) => b.name ?? b.folder;
    const out: string[] = [];
    const projects = new Set([...w.sessions.map((b) => b.folder), ...finished.map((f) => folderLabel(f.cwd))]);
    out.push(`Today · ${projects.size} project${projects.size === 1 ? "" : "s"} · ${w.sessions.length ? `${w.sessions.length} open session${w.sessions.length === 1 ? "" : "s"}` : "no open sessions"}${w.fiveHourPct != null ? ` · 5-hour limit ${Math.round(w.fiveHourPct)}%` : ""}${w.sevenDayPct != null ? ` · week ${Math.round(w.sevenDayPct)}%` : ""}`);
    const needs = w.sessions.filter((b) => b.needsYou);
    const blocked = w.sessions.filter((b) => !b.needsYou && (b.stopped || b.status === "failed" || b.maybeStuck));
    const working = w.sessions.filter((b) => b.status === "running" && !b.maybeStuck);
    const unproven = w.sessions.filter((b) => b.turn?.proof === "unverified" && b.turn.done);
    const failing = w.sessions.filter((b) => b.turn?.proof === "failing");
    const risky = w.sessions.filter((b) => (b.risks ?? []).length);
    const section = (title: string, rows: string[]) => { if (rows.length) out.push("", title, ...rows.map((r) => `  ${r}`)); };
    section("Needs you", needs.map((b) => `${name(b)}: ${oneLine(b.waitingFor ?? b.reason, 90) || b.word}`));
    section("Stuck or stopped", blocked.map((b) => `${name(b)}: ${b.stopped ? "stopped mid-task" : b.status === "failed" ? "its last turn failed" : "may be stuck"}`));
    const turn = w.sessions.filter((b) => isYourTurn(b.status, b.finishedAt, Date.now()));
    section("Your turn (finished, waiting for your next message)", turn.map((b) => `${name(b)}: ${b.turn?.proof === "verified" ? "tests passed after its changes" : b.turn?.proof === "failing" ? "tests failing" : b.turn?.proof === "unverified" ? "changed files, not tested" : "answered"}${b.task ? ` · “${oneLine(b.task, 50)}”` : ""}`));
    section("Working", working.map((b) => `${name(b)}: ${b.checklist && b.checklist.done < b.checklist.total ? `step ${b.checklist.done + 1} of ${b.checklist.total}` : oneLine(b.now ?? null, 60) ?? "working"}${b.contextPct != null ? ` · chat ${Math.round(b.contextPct)}% full` : ""}`));
    section("Check before you trust it", [
      ...failing.map((b) => `${name(b)}: tests failing after its last change`),
      ...unproven.map((b) => `${name(b)}: finished, but no tests ran after its changes`),
      ...risky.map((b) => `${name(b)}: ${b.risks![0]}`),
    ]);
    section("Finished turns today", finished.slice(0, 8).map((f) => `${folderLabel(f.cwd)}: ${f.n} turn${f.n === 1 ? "" : "s"}`));
    const next = needs[0] ? `Answer ${name(needs[0])} (bp go takes you there)` : failing[0] ? `Ask ${name(failing[0])} to fix the failing tests` : blocked[0] ? `Check ${name(blocked[0])} (bp go ${name(blocked[0])})` : unproven[0] ? `Ask ${name(unproven[0])} to run the tests` : turn[0] ? `Reply to ${name(turn[0])}: it finished and is waiting for you` : w.sessions.find((b) => (b.contextPct ?? 0) >= 70) ? `Start a fresh chat in ${name(w.sessions.find((b) => (b.contextPct ?? 0) >= 70)!)} (it's ${Math.round(w.sessions.find((b) => (b.contextPct ?? 0) >= 70)!.contextPct!)}% full)` : null;
    out.push("", next ? `Next: ${next}` : w.sessions.length || finished.length ? "Nothing needs you right now." : "No Claude sessions today yet.");
    console.log(out.join("\n"));
    return;
  }
  if (cmd === "jump") {
    // For the menu-bar widget and notifications: bring a session's Terminal/iTerm tab (or tmux pane) forward.
    // Exit 3 = its tab wasn't found (the caller can open a Terminal in that folder instead).
    const cwd = rest[0] ? path.resolve(rest[0]) : "";
    if (!cwd || !fs.existsSync(cwd)) { process.exitCode = 2; return; }
    const { findBuild } = await import("./core/termfind");
    let startedAt: number | null = null;
    if (rest[1]) { const e = new Engine({ light: true }); await e.start(); startedAt = e.sessionStartedAt(rest[1]); e.stop(); }
    const r = await findBuild(cwd, startedAt);
    console.log(r.how);
    if (!r.found) process.exitCode = 3;
    return;
  }
  if (cmd === "go") {
    const engine = new Engine({ light: true });
    await engine.start();
    const w = widgetData(engine);
    const startedAt = new Map(w.sessions.map((x) => [x.id, engine.sessionStartedAt(x.id)])); // read before closing the database
    engine.stop();
    const want = rest[0]?.toLowerCase();
    const target = want ? w.sessions.find((s) => (s.name ?? s.folder).toLowerCase() === want || (s.name ?? s.folder).toLowerCase().includes(want) || s.folder.toLowerCase().includes(want)) : w.sessions.find((s) => s.needsYou) ?? w.sessions[0];
    if (!target) {
      console.log(want ? `No build matching "${rest[0]}". Running: ${w.sessions.map((s) => s.folder).join(", ") || "none"}` : "No Claude sessions running.");
      process.exitCode = 1;
      return;
    }
    const { findBuild } = await import("./core/termfind");
    const r = await findBuild(target.cwd, startedAt.get(target.id) ?? null);
    const what = target.needsYou ? ` (waiting: ${target.waitingFor ?? target.reason ?? target.word})` : target.now ? ` (${target.now})` : "";
    console.log(r.found ? `→ ${target.name ?? target.folder}${what} in ${r.how}` : `${target.name ?? target.folder}${what}\n  ${r.how}\n  cd "${target.cwd}"`);
    return;
  }
  if (cmd === "review" || cmd === "merge") {
    const folder = path.resolve(process.cwd());
    const engine = new Engine();
    await engine.start();
    await engine.openProject(folder);
    const builds = await engine.extraBuilds();
    const b = builds.find((x) => path.basename(x.dir) === rest[0] || x.branch === rest[0] || x.branch === `bp/${rest[0]}` || path.basename(x.dir).endsWith(`-${rest[0]}`)) ?? (builds.length === 1 && !rest[0] ? builds[0] : undefined);
    if (!b) {
      console.log(`Which build? ${builds.map((x) => path.basename(x.dir)).join(", ") || "(none; start one with bp new)"}`);
      engine.stop();
      process.exitCode = 1;
      return;
    }
    const ch = await engine.buildChanges(b.dir, b.branch);
    if (cmd === "review") {
      console.log(ch.files.length ? `${path.basename(b.dir)} (${b.branch}): ${ch.files.length} file${ch.files.length === 1 ? "" : "s"}${ch.unsaved ? `, ${ch.unsaved} not saved yet` : ""}\n${ch.files.map((f) => `  ${f.status} ${f.path}`).join("\n")}\nSee the full diff:  git -C "${b.dir}" diff ${ch.base ?? "HEAD"}` : `${path.basename(b.dir)} hasn't changed anything yet.`);
    } else {
      if (!ch.files.length) console.log("Nothing to merge yet.");
      else {
        if (ch.unsaved) await engine.saveBuild(b.dir, `Work from ${path.basename(b.dir)} (saved by BuildPilot before merging)`);
        const r = await engine.mergeBuild(b.branch);
        console.log(r.merged ? `${r.message} Remove its folder: bp done ${path.basename(b.dir)}` : `${r.message}${r.conflicts.length ? `\n  ${r.conflicts.join("\n  ")}\nAsk the Claude in that build: "git merge <your main branch>, resolve the conflicts, run tests, commit", then bp merge again.` : ""}`);
        if (!r.merged) process.exitCode = 1;
      }
    }
    engine.stop();
    return;
  }
  if (cmd === "who") {
    if (!rest[0]) return usage('Usage: bp who <file>   which Claude build changed it, and when');
    const engine = new Engine({ light: true });
    await engine.start();
    const rows = engine.fileHistory(rest[0]);
    const names = new Map(widgetData(engine).sessions.map((s) => [s.id, s.name ?? s.folder]));
    engine.stop();
    if (!rows.length) console.log(`No build has changed a file matching "${rest[0]}" recently.`);
    for (const r of rows) console.log(`  ${path.basename(r.path).padEnd(28)} ${r.edits}× by ${names.get(r.sessionId) ?? path.basename(r.cwd)} · ${new Date(r.lastTs).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}\n    ${r.path}`);
    if (rows.length) console.log("\nUndo one file (back to its last commit): git checkout -- <path>   (or use Undo in bp ui, which saves a safety point first)");
    return;
  }
  if (cmd === "builds" || cmd === "done") {
    const folder = path.resolve(process.cwd());
    const engine = new Engine();
    await engine.start();
    await engine.openProject(folder);
    const builds = await engine.extraBuilds();
    if (cmd === "builds") {
      console.log(builds.length ? builds.map((b) => `  ${path.basename(b.dir).padEnd(32)} ${b.branch}${b.dirty ? "  (unsaved changes)" : ""}`).join("\n") : "No extra builds. Start one: bp new \"<name>\"");
    } else {
      const target = builds.find((b) => path.basename(b.dir) === rest[0] || b.branch === rest[0] || b.branch === `bp/${rest[0]}` || path.basename(b.dir).endsWith(`-${rest[0]}`));
      if (!target) {
        console.log(`No build called "${rest[0] ?? ""}". Yours:\n${builds.map((b) => `  ${path.basename(b.dir)}`).join("\n") || "  (none)"}`);
        process.exitCode = 1;
      } else {
        try {
          await engine.removeBuild(target.dir);
          console.log(`Removed ${path.basename(target.dir)}. Its branch ${target.branch} is kept. Merge it with:  git merge ${target.branch}`);
        } catch (e) {
          console.log(`Couldn't remove it: ${(e as Error).message}`);
          process.exitCode = 1;
        }
      }
    }
    engine.stop();
    return;
  }
  if (cmd === "new") {
    const folder = path.resolve(process.cwd());
    const engine = new Engine();
    await engine.start();
    await engine.openProject(folder);
    const extra = Math.max(0, (await worktrees(folder)).length - 1);
    const g = gateParallel(engine.home, extra);
    if (!g.allowed) {
      engine.stop();
      console.log(paywallText(g.paywall));
      process.exitCode = 2;
      return;
    }
    try {
      const noEnv = rest.includes("--no-env");
      const w = await engine.createWorktree(rest.filter((x) => !x.startsWith("--"))[0] || "build", { copyEnv: !noEnv });
      if (w.copied.length) console.log(`Copied ${w.copied.join(", ")} into the new build (use --no-env to skip).`);
      engine.stop();
      if (process.env.TMUX) {
        execFile("tmux", ["new-window", "-c", w.dir, "-n", path.basename(w.dir).slice(0, 20), "claude"], () => {});
        console.log(`New build started in a tmux window: ${w.dir} (branch ${w.branch}).\nTwo builds use your plan limit about twice as fast. When done: git merge ${w.branch} && bp done ${path.basename(w.dir)}`);
      } else console.log(`New build ready: ${w.dir} (branch ${w.branch})\nStart it:  cd "${w.dir}" && claude\nTwo builds use your plan limit about twice as fast. When done: git merge ${w.branch} && bp done ${path.basename(w.dir)}`);
    } catch (e) {
      engine.stop();
      const msg = (e as Error).message;
      console.log(/at least one commit/.test(msg) ? "A new build needs undo (Git) with one save point first. Run:  git init && git add -A && git commit -m \"First save point\"" : `Couldn't start the build: ${msg}`);
      process.exitCode = 1;
    }
    return;
  }
  if (cmd === "limits") {
    const engine = new Engine({ light: true });
    await engine.start();
    const p = pageData(engine, null);
    engine.stop();
    console.log(limitsText(p));
    return;
  }
  if (cmd === "prompt" && rest[0] === "auto") rest[0] = guessGoal(rest[1] ?? "");
  if (cmd === "prompt" && (!rest[0] || !GOALS.some((g) => g.id === rest[0]))) {
    return usage(`${rest[0] ? `Unknown goal "${rest[0]}". ` : ""}Usage: bp prompt <goal> "<what you want>"\n\nGoals:\n${GOALS.map((g) => `  ${g.id.padEnd(14)} ${g.label}`).join("\n")}\n\nExample: bp prompt bugfix "the login button does nothing on mobile"`);
  }
  const folderArg = cmd === "prompt" ? rest[2] : cmd === "visual" ? rest[0] && !/^https?:/.test(rest[0]) ? rest[0] : undefined : rest[0];
  const folder = path.resolve(folderArg ?? process.cwd());
  const markers = [".git", "package.json", "pyproject.toml", "requirements.txt", "go.mod", "Cargo.toml", "CLAUDE.md", ".claude"];
  if (!markers.some((m) => fs.existsSync(path.join(folder, m))) || folder === os.homedir()) {
    const engine = new Engine({ light: true });
    await engine.start();
    console.log(glance(engine, { cwd: folder, columns: process.stdout.columns ?? 80, color: !!process.stdout.isTTY && !process.env.NO_COLOR }));
    console.log(`\n${folder} doesn't look like a project folder. cd into a project (one with .git or package.json) and run bp again.`);
    engine.stop();
    return;
  }
  const engine = new Engine();
  await engine.start();
  await engine.openProject(folder);
  const st = engine.snapshot();
  switch (cmd) {
    case "brief":
      console.log(engine.brief(st));
      break;
    case "status":
      console.log(`${st.facts?.name}: ${st.out.health.label}`);
      if (st.out.progress.total > 0) console.log(`Progress: ${st.out.progress.label}`);
      for (const i of st.out.issues.slice(0, 10)) console.log(`  [${i.severity}] ${i.title}`);
      if (st.out.next) console.log(`Next: ${st.out.next.title}\n  ${st.out.next.why}`);
      break;
    case "sessions":
      for (const s of st.out.sessions) {
        const when = new Date(s.lastEventAt);
        const time = when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        const day = when.toDateString() === new Date().toDateString() ? time : `${when.toLocaleDateString([], { weekday: "short" })} ${time}`;
        const task = (s.currentTask ?? "").replace(/\s+/g, " ");
        const status = s.displayStatus === "idle" ? "Idle" : STATUS_PLAIN[s.displayStatus] ?? s.displayStatus;
        const line = `${status.padEnd(15)} ${day.padEnd(13)} ${task.length > 80 ? `${task.slice(0, 79)}…` : task || "(no prompt yet)"}`;
        console.log(process.env.NO_COLOR ? `${line}  (${s.id.slice(0, 8)})` : `${line}  \x1b[2m(${s.id.slice(0, 8)})\x1b[0m`);
      }
      if (!st.out.sessions.length) console.log(st.hooks.installed ? "No sessions observed for this folder yet." : "BuildPilot isn't connected yet: run bp hooks install (or install the Claude Code plugin).");
      break;
    case "handoff":
      console.log(engine.handoff(st));
      break;
    case "audit": {
      const r = await engine.audit();
      console.log(r.ok ? `${r.tool}: ${r.counts.critical} critical, ${r.counts.high} high, ${r.counts.moderate} moderate, ${r.counts.low} low` : `audit could not run: ${r.error}`);
      for (const t of r.top) console.log(`  ${t.severity.padEnd(9)} ${t.name}: ${t.title}${t.fixAvailable ? " (fix available)" : ""}`);
      break;
    }
    case "visual": {
      const url = rest.find((x) => /^https?:/.test(x)) ?? st.appUrl.url;
      if (!url) {
        console.log("No app address detected. Usage: buildpilot visual <folder> <url>");
        break;
      }
      const r = await engine.visualCheck(url);
      console.log(`${url}: ${r.note}${r.title ? ` (title: ${r.title})` : ""}${r.screenshot ? `\nscreenshot: ${r.screenshot}` : ""}`);
      break;
    }
    case "prompt": {
      const goal = rest[0] as GoalType;
      const r = engine.gatedPrompt({ goal, request: rest[1] ?? "" }, st);
      if ("paywall" in r) {
        console.log(paywallText(r.paywall));
        process.exitCode = 2;
        break;
      }
      console.log(r.prompt.text);
      if (r.remaining !== null && r.remaining <= 5) console.error(`\n${r.remaining} free prompt${r.remaining === 1 ? "" : "s"} left.`);
      break;
    }
    case "serve": {
      const api = new IntegrationApi(engine, { port: Number(process.env.BUILDPILOT_PORT ?? 47821), host: "127.0.0.1", token: loadOrCreateToken(engine.home) });
      await api.start();
      console.log(`BuildPilot Integration API on ${api.address} (token: ${path.join(engine.home, "api-token")}). Ctrl+C to stop.`);
      process.on("SIGINT", () => {
        void api.stop().then(() => {
          engine.stop();
          process.exit(0);
        });
      });
      return;
    }
    default:
      console.error(`Unknown command ${cmd}. Try --help.`);
      process.exitCode = 2;
  }
  engine.stop();
}

main().catch((e) => {
  console.error(`buildpilot: ${(e as Error).message}`);
  process.exit(1);
});

function limitsText(p: PageData): string {
  const t = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const lines: string[] = [];
  if (p.plan.sellable && !p.plan.licensed) lines.push(p.plan.trialDaysLeft != null ? `Pro trial: ${p.plan.trialDaysLeft} day${p.plan.trialDaysLeft === 1 ? "" : "s"} left (after it: 2 builds at once, 20 prompts; limits and forecast stay free)` : `Free plan. Unlimited parallel builds + tests before merge + per-build usage: Pro (${p.plan.price}) · bp license <key>`);
  lines.push(p.builds.length ? `${p.builds.filter((b) => b.needsYou || b.stopped || b.status === "running" || Date.now() - b.lastEventAt < 2 * 3600_000).length} active session${p.builds.length === 1 ? "" : "s"}${p.working ? ` · ${p.working} working` : ""}${p.needs ? ` · ${p.needs} need${p.needs === 1 ? "s" : ""} you` : ""}` : "No Claude sessions running.");
  for (const b of p.builds.slice(0, 10)) lines.push(`  ${b.needsYou ? "!" : b.stopped ? "×" : "•"} ${`${b.name ?? b.folder}${b.agent === "codex" ? " (Codex)" : ""}`.padEnd(24)} ${b.needsYou ? `waiting: ${oneLine(b.waitingFor ?? b.reason, 60) || b.word}` : b.stopped ? "stopped mid-task" : oneLine(b.now ?? null, 70) ?? b.word}${(b.errors1h ?? 0) > 0 ? ` · ${b.errors1h} error${b.errors1h === 1 ? "" : "s"}` : ""}${b.contextPct != null ? ` · chat ${Math.round(b.contextPct)}% full` : ""}${b.costUsd != null ? ` · ~$${b.costUsd.toFixed(2)} today` : b.share != null ? ` · ${b.share}% of your usage today` : ""}`);
  const L = p.limits;
  if (p.billing === "api") lines.push("", `Spend today   ${p.costTodayUsd != null ? `~$${p.costTodayUsd.toFixed(2)}` : "unknown"}`);
  else if (L.fiveHourPct != null || L.sevenDayPct != null) {
    lines.push("", `5-hour limit  ${L.fiveHourPct != null ? `${Math.round(L.fiveHourPct)}%` : "unknown"}${L.fiveHourResetsAt ? ` · resets ${t(L.fiveHourResetsAt)}` : ""}${L.fullAt ? ` · runs out ~${t(L.fullAt)} at this pace` : ""}`);
    lines.push(`Weekly limit  ${L.sevenDayPct != null ? `${Math.round(L.sevenDayPct)}%` : "unknown"}${L.sevenDayResetsAt ? ` · resets ${new Date(L.sevenDayResetsAt).toLocaleDateString([], { weekday: "long" })}` : ""}`);
    if (L.fullAt) lines.push(`              (forecast = straight line through your last ${L.basisMin ?? "?"} min${L.accuracy ? `; ${L.accuracy.toLowerCase()}` : ""})`);
  } else lines.push("", "Plan limits   not reported yet. Turn on with /bp-connect (plugin) or: bp statusline install");
  if (p.tips.length) lines.push("", "Tips", ...p.tips.map((x) => `  → ${x.text}`));
  return lines.join("\n");
}
