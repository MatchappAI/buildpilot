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
import { glance, widgetData } from "./core/glance";
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
      console.log(json ? JSON.stringify(st) : !st.supported ? "The menu-bar widget is macOS only." : st.installed ? `Installed (${st.appPath}), ${st.running ? "running" : "not running"}${st.startAtLogin ? ", starts at login" : ""}.` : "Not installed. Install: VS Code → BuildPilot → Connect → Menu-bar widget.");
    } else return usage(`Unknown option "${sub}". Use: bp bar status | install | uninstall`);
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
      console.log(json ? JSON.stringify(r) : r.changed ? `Exact context % on.${r.chained ? " Your existing status line keeps showing." : ""} New or resumed Claude Code sessions will report it.` : "Already on.");
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
    console.log(`BuildPilot: mission control for Claude Code

Everyday
  bp limits                 your builds, chat % full, plan limits + forecast, tips
  bp new "<name>"           start another build in its own copy of this project (--no-env: don't copy .env files)
  bp review · bp merge <name>  see what a side build changed · bring it into your project
  bp builds · bp done <name>  list extra builds · remove a finished one (branch kept)
  bp go [name]              jump to the build that needs you (its tmux pane, or prints cd)
  bp prompt auto "<what>"   turn plain words into an expert prompt (prints it; run: claude "$(bp prompt auto '...')")
  bp license [key]          show your plan, or unlock Pro with a key

Setup
  bp statusline install     exact chat % and plan limits (keeps your own status line)
  bp hooks install          let BuildPilot see your builds   (uninstall to undo)
  bp tmux                   one-line status for tmux/your prompt

More: bp (folder status) · glance · sessions · brief · handoff · audit · visual [url]
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
  if (cmd === "go") {
    const engine = new Engine({ light: true });
    await engine.start();
    const w = widgetData(engine);
    engine.stop();
    const want = rest[0]?.toLowerCase();
    const target = want ? w.sessions.find((s) => s.folder.toLowerCase() === want || s.folder.toLowerCase().includes(want)) : w.sessions.find((s) => s.needsYou) ?? w.sessions[0];
    if (!target) {
      console.log(want ? `No build matching "${rest[0]}". Running: ${w.sessions.map((s) => s.folder).join(", ") || "none"}` : "No builds running.");
      process.exitCode = 1;
      return;
    }
    if (process.env.TMUX) {
      const panes = await new Promise<string>((resolve) => execFile("tmux", ["list-panes", "-a", "-F", "#{session_name}:#{window_index}.#{pane_index}\t#{pane_current_path}"], { timeout: 5000 }, (_e, out) => resolve(String(out ?? ""))));
      const hit = panes.split("\n").map((l) => l.split("\t")).find(([, p]) => p && path.resolve(p) === path.resolve(target.cwd));
      if (hit?.[0]) {
        execFile("tmux", ["select-window", "-t", hit[0]], () => execFile("tmux", ["select-pane", "-t", hit[0]!], () => {}));
        console.log(`→ ${target.folder}${target.needsYou ? ` (waiting: ${target.reason || target.word})` : ""}`);
        return;
      }
    }
    console.log(`${target.folder}${target.needsYou ? ` is waiting: ${target.reason || target.word}` : ""}\n  cd "${target.cwd}"`);
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
      console.log(`${st.facts?.name}: stage ${st.out.stage.stage} (${st.out.stage.confidence}), ${st.out.health.label}`);
      console.log(`Progress: ${st.out.progress.label}`);
      for (const i of st.out.issues.slice(0, 10)) console.log(`  [${i.severity}] ${i.title}`);
      if (st.out.next) console.log(`Next: ${st.out.next.title}\n  ${st.out.next.why}`);
      break;
    case "sessions":
      for (const s of st.out.sessions) console.log(`${s.id.slice(0, 8)}  ${s.displayStatus.padEnd(17)} ${new Date(s.lastEventAt).toLocaleTimeString()}  ${s.currentTask ?? ""}`);
      if (!st.out.sessions.length) console.log(st.hooks.installed ? "No sessions observed for this folder yet." : "Hooks not installed: run `buildpilot hooks install`.");
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
  lines.push(p.builds.length ? `${p.builds.length} build${p.builds.length === 1 ? "" : "s"}${p.working ? ` · ${p.working} working` : ""}${p.needs ? ` · ${p.needs} need${p.needs === 1 ? "s" : ""} you` : ""}` : "No builds running.");
  for (const b of p.builds.slice(0, 6)) lines.push(`  ${b.needsYou ? "!" : "•"} ${b.folder.padEnd(24)} ${b.needsYou ? b.reason || b.word : b.word}${b.contextPct != null ? ` · chat ${Math.round(b.contextPct)}% full` : ""}${b.costUsd != null ? ` · ~$${b.costUsd.toFixed(2)} today` : b.share != null ? ` · ${b.share}% of your usage today` : ""}`);
  const L = p.limits;
  if (p.billing === "api") lines.push("", `Spend today   ${p.costTodayUsd != null ? `~$${p.costTodayUsd.toFixed(2)}` : "unknown"}`);
  else if (L.fiveHourPct != null || L.sevenDayPct != null) {
    lines.push("", `Next 5 hours  ${L.fiveHourPct != null ? `${Math.round(L.fiveHourPct)}%` : "unknown"}${L.fiveHourResetsAt ? ` · resets ${t(L.fiveHourResetsAt)}` : ""}${L.fullAt ? ` · runs out ~${t(L.fullAt)} at this pace` : ""}`);
    lines.push(`This week     ${L.sevenDayPct != null ? `${Math.round(L.sevenDayPct)}%` : "unknown"}`);
    if (L.fullAt) lines.push(`              (forecast = straight line through your last ${L.basisMin ?? "?"} min${L.accuracy ? `; ${L.accuracy.toLowerCase()}` : ""})`);
  } else lines.push("", "Plan limits   not reported yet. Turn on with /bp-connect (plugin) or: bp statusline install");
  if (p.tips.length) lines.push("", "Tips", ...p.tips.map((x) => `  → ${x.text}`));
  return lines.join("\n");
}
