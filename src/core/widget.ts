import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildpilotHome } from "./hooks";
import { installCliCopy } from "./shell";
import { EXT_ID } from "./extId";

/**
 * The macOS menu-bar companion ("BuildPilot Bar.app"). It ships zipped inside the extension, is installed into
 * ~/Applications (no admin rights), and reads data by running BuildPilot's own CLI. Fully reversible.
 */

export const WIDGET_APP = "BuildPilot Bar.app";
export const WIDGET_BUNDLE_ID = "com.buildpilot.bar";
export const WIDGET_LOGIN_PLIST = () => path.join(os.homedir(), "Library", "LaunchAgents", `${WIDGET_BUNDLE_ID}.plist`);

export interface WidgetRuntime {
  /** Executable that runs Node scripts: a real `node`, or VS Code's Electron with ELECTRON_RUN_AS_NODE. */
  node: string;
  electronAsNode: boolean;
}

export interface WidgetStatus {
  supported: boolean;
  installed: boolean;
  appPath: string | null;
  running: boolean;
  startAtLogin: boolean;
}

const appCandidates = () => [path.join(os.homedir(), "Applications", WIDGET_APP), path.join("/Applications", WIDGET_APP)];

export function widgetStatus(): WidgetStatus {
  if (process.platform !== "darwin") return { supported: false, installed: false, appPath: null, running: false, startAtLogin: false };
  const appPath = appCandidates().find((p) => fs.existsSync(p)) ?? null;
  let running = false;
  try {
    running = execFileSync("/usr/bin/pgrep", ["-f", `${WIDGET_APP}/Contents/MacOS/`], { encoding: "utf8", timeout: 3000 }).trim().length > 0;
  } catch {
    running = false;
  }
  return { supported: true, installed: !!appPath, appPath, running, startAtLogin: fs.existsSync(WIDGET_LOGIN_PLIST()) };
}

/** Best runtime for the widget: a real Node if one is on a standard path, else the given fallback (VS Code's Electron). */
export function pickRuntime(fallback?: WidgetRuntime): WidgetRuntime | null {
  const candidates = [process.env.BUILDPILOT_NODE, "/opt/homebrew/bin/node", "/usr/local/bin/node", path.join(os.homedir(), ".local/bin/node"), path.join(os.homedir(), ".volta/bin/node")];
  // When this code itself runs under a real Node (the CLI), that Node is the best choice.
  if (!process.versions.electron) candidates.unshift(process.execPath);
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return { node: c, electronAsNode: false };
  }
  return fallback ?? null;
}

export function installWidget(opts: { zip: string; cliDir: string; runtime: WidgetRuntime; startAtLogin: boolean; home?: string; appsDir?: string; launch?: boolean }): { appPath: string } {
  if (process.platform !== "darwin") throw new Error("The menu-bar widget is for macOS.");
  if (!fs.existsSync(opts.zip)) throw new Error(`Widget package missing: ${opts.zip}`);
  const home = opts.home ?? buildpilotHome();
  const appsDir = opts.appsDir ?? path.join(os.homedir(), "Applications");
  fs.mkdirSync(appsDir, { recursive: true });
  const appPath = path.join(appsDir, WIDGET_APP);
  quitWidget(appPath);
  // Extract to a temp folder first, then swap in, so a failed extract never leaves a half-installed app.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bp-bar-"));
  try {
    execFileSync("/usr/bin/ditto", ["-x", "-k", opts.zip, tmp], { timeout: 60_000 });
    const extracted = path.join(tmp, WIDGET_APP);
    if (!fs.existsSync(extracted)) throw new Error("Widget package is damaged.");
    fs.rmSync(appPath, { recursive: true, force: true });
    execFileSync("/usr/bin/ditto", [extracted, appPath], { timeout: 60_000 });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  installCliCopy(opts.cliDir, home);
  fs.writeFileSync(path.join(home, "widget-config.json"), JSON.stringify({ node: opts.runtime.node, electronAsNode: opts.runtime.electronAsNode, cli: path.join(home, "bin", "cli.js"), extensionId: EXT_ID }, null, 2), { mode: 0o600 });
  setStartAtLogin(opts.startAtLogin, appPath);
  if (opts.launch !== false) execFileSync("/usr/bin/open", ["-g", appPath], { timeout: 10_000 });
  return { appPath };
}

export function setStartAtLogin(on: boolean, appPath: string): void {
  const plist = WIDGET_LOGIN_PLIST();
  if (!on) {
    fs.rmSync(plist, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(plist), { recursive: true });
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  fs.writeFileSync(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${WIDGET_BUNDLE_ID}</string>
  <key>ProgramArguments</key><array><string>/usr/bin/open</string><string>-g</string><string>-a</string><string>${esc(appPath)}</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>
`,
  );
}

export function quitWidget(appPath?: string): void {
  const pattern = (appPath ? `${appPath}/Contents/MacOS/` : `${WIDGET_APP}/Contents/MacOS/`).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    execFileSync("/usr/bin/pkill", ["-f", pattern], { timeout: 3000 });
  } catch {
    /* not running */
  }
}

/** Quits the widget, removes the login item, and moves the app to the Trash (never deletes outright). */
export function uninstallWidget(home = buildpilotHome()): { removed: string[] } {
  const removed: string[] = [];
  for (const p of appCandidates()) if (fs.existsSync(p)) quitWidget(p);
  if (fs.existsSync(WIDGET_LOGIN_PLIST())) {
    fs.rmSync(WIDGET_LOGIN_PLIST(), { force: true });
    removed.push("login item");
  }
  const trash = process.env.BP_TEST_TRASH || path.join(os.homedir(), ".Trash");
  for (const p of appCandidates()) {
    if (!fs.existsSync(p)) continue;
    fs.mkdirSync(trash, { recursive: true });
    let dest = path.join(trash, WIDGET_APP);
    if (fs.existsSync(dest)) dest = path.join(trash, `BuildPilot Bar ${Date.now()}.app`);
    fs.renameSync(p, dest);
    removed.push(p);
  }
  fs.rmSync(path.join(home, "widget-config.json"), { force: true });
  return { removed };
}
