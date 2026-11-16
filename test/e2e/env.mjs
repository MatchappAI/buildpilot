import { spawn, execFileSync } from "child_process";
import fs from "fs"; import path from "path"; import os from "os"; import { fileURLToPath } from "url";
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(REPO, "plugin/bin/cli.js");
export function makeEnv() {
  // Not under /tmp: BuildPilot hides sessions in temp folders (headless runs), so the throwaway home lives in the user cache folder.
  const base = path.join(os.homedir(), process.platform === "darwin" ? "Library/Caches" : ".cache"); fs.mkdirSync(base, { recursive: true });
  const home = fs.mkdtempSync(path.join(base, "bp-e2e."));
  const env = { ...process.env, HOME: home, NO_COLOR: "1", BUILDPILOT_OS_LOG: path.join(home, "os.log") };
  for (const k of ["CLAUDE_CONFIG_DIR", "BUILDPILOT_HOME", "TMUX", "BUILDPILOT_LICENSE_KEY", "BUILDPILOT_AUTH_TOKEN"]) delete env[k];
  const proj = path.join(home, "proj"); fs.mkdirSync(proj);
  const g = (...a) => execFileSync("git", a, { cwd: proj, env });
  g("init", "-q"); fs.writeFileSync(path.join(proj, "package.json"), '{"name":"demo","scripts":{"test":"node -e 0"}}'); g("add", "-A"); g("-c", "user.email=a@b", "-c", "user.name=t", "commit", "-qm", "init");
  const cli = (args, opts = {}) => { try { return { out: execFileSync("node", [CLI, ...args], { cwd: opts.cwd ?? proj, env, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }), code: 0 }; } catch (e) { return { out: String(e.stdout ?? "") + String(e.stderr ?? ""), code: e.status }; } };
  const spool = (obj) => execFileSync("sh", [path.join(REPO, "plugin/hooks/spool.sh")], { input: typeof obj === "string" ? obj : JSON.stringify(obj), env });
  const osLog = () => { try { return fs.readFileSync(env.BUILDPILOT_OS_LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  let server = null;
  process.on("exit", () => { try { server?.kill("SIGKILL"); } catch {} });
  const startUi = async () => {
    server = spawn("node", [CLI, "ui", "--serve", proj], { env, stdio: "ignore", detached: false });
    const info = path.join(home, ".buildpilot", "ui-server.json");
    for (let i = 0; i < 100 && !fs.existsSync(info); i++) await new Promise((r) => setTimeout(r, 100));
    const url = cli(["ui", "--print"]).out.trim();
    return { url, info: JSON.parse(fs.readFileSync(info, "utf8")) };
  };
  const cleanup = () => { if (server) server.kill("SIGTERM"); if (!process.env.BP_E2E_KEEP) fs.rmSync(home, { recursive: true, force: true }); };
  return { home, proj, env, cli, spool, osLog, startUi, cleanup, settings: () => { try { return JSON.parse(fs.readFileSync(path.join(home, ".claude/settings.json"), "utf8")); } catch { return null; } } };
}
