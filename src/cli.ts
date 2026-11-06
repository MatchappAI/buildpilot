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
import * as path from "path";
import { IntegrationApi, loadOrCreateToken } from "./core/api";
import { Engine } from "./core/engine";
import { claudeSettingsPath, hookStatus, installHooks, installStatusline, statuslineStatus, uninstallHooks, uninstallStatusline } from "./core/hooks";
import { GOALS } from "./core/prompts";
import { GoalType } from "./core/types";

async function main(): Promise<void> {
  const [cmd = "brief", ...rest] = process.argv.slice(2);
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
    console.log("usage: buildpilot brief|status|sessions|handoff|audit|visual [url]|prompt <goal> <request>|hooks [status|install|uninstall]|serve [folder]");
    console.log(`goals: ${GOALS.map((g) => g.id).join(", ")}`);
    return;
  }
  const folderArg = cmd === "prompt" ? rest[2] : rest[0];
  const engine = new Engine();
  await engine.start();
  await engine.openProject(path.resolve(folderArg ?? process.cwd()));
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
      const url = rest[1] ?? st.appUrl.url;
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
