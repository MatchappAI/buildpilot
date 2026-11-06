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
import { claudeSettingsPath, hookStatus, installHooks, installStatusline, statuslineStatus, uninstallHooks, uninstallStatusline } from "./core/hooks";
import { glance } from "./core/glance";
import { GOALS } from "./core/prompts";
import { installShell, shellStatus, uninstallShell } from "./core/shell";
import { execFile } from "child_process";
import { GoalType } from "./core/types";

async function main(): Promise<void> {
  const [cmd = "status", ...rest] = process.argv.slice(2);
  if (cmd === "glance") {
    // Fast path for new terminals: no project analysis, no tool probing.
    const engine = new Engine({ light: true });
    await engine.start();
    console.log(glance(engine, { cwd: process.cwd(), columns: process.stdout.columns ?? 80, color: !!process.stdout.isTTY && !process.env.NO_COLOR }));
    engine.stop();
    return;
  }
  if (cmd === "open") {
    const folder = path.resolve(rest[0] ?? process.cwd());
    const uri = `vscode://buildpilot-local.buildpilot/open?folder=${encodeURIComponent(folder)}`;
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
    } else console.log(shellStatus());
    return;
  }
  if (cmd === "hooks") {
    const pi = rest.indexOf("--project");
    const file = pi >= 0 ? claudeSettingsPath("project", path.resolve(rest[pi + 1] ?? ".")) : claudeSettingsPath("user");
    const sub = rest[0] ?? "status";
    if (sub === "install") console.log(installHooks(file));
    else if (sub === "uninstall") console.log(uninstallHooks(file));
    else console.log(hookStatus(file));
    return;
  }
  if (cmd === "statusline") {
    const file = claudeSettingsPath("user");
    const sub = rest[0] ?? "status";
    if (sub === "install") console.log(installStatusline(file));
    else if (sub === "uninstall") console.log(uninstallStatusline(file));
    else console.log(statuslineStatus(file));
    return;
  }
  if (cmd === "help" || cmd === "--help") {
    console.log(`BuildPilot: mission control for Claude Code

  bp                       full status of this folder (stage, health, issues, next step)
  bp glance                the short summary shown when a terminal opens
  bp sessions              Claude Code sessions in this folder
  bp brief                 one-sentence status
  bp open                  open BuildPilot in VS Code for this folder
  bp prompt <goal> "<what you want>"   write an expert Claude Code prompt
  bp handoff               context handoff for a new session
  bp audit                 check dependencies for known vulnerabilities
  bp visual [url]          check your running app + screenshot
  bp hooks|statusline|shell  status | install | uninstall
  bp serve                 Integration API without VS Code`);
    console.log(`goals: ${GOALS.map((g) => g.id).join(", ")}`);
    return;
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
      const goal = (GOALS.some((g) => g.id === rest[0]) ? rest[0] : "feature") as GoalType;
      console.log(engine.prompt({ goal, request: rest[1] ?? "" }, st).text);
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
