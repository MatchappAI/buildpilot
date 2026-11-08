import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Engine } from "../../src/core/engine";
import { widgetData } from "../../src/core/glance";
import { installWidget, uninstallWidget, widgetStatus } from "../../src/core/widget";
import { tmpDir } from "./helpers";

function spool(home: string, name: string, payload: Record<string, unknown>) {
  fs.mkdirSync(path.join(home, "spool"), { recursive: true });
  fs.writeFileSync(path.join(home, "spool", name), JSON.stringify(payload));
}

describe("menu-bar widget data (bp widget)", () => {
  it("lists sessions across folders, needs-you first, with one-line reasons", async () => {
    const home = tmpDir();
    spool(home, "1.json", { session_id: "w1", cwd: "/work/site", hook_event_name: "UserPromptSubmit", prompt: "Make the\nhomepage faster" });
    spool(home, "2.json", { session_id: "w2", cwd: "/work/api", hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "npm publish\n--access public" } });
    const engine = new Engine({ home, light: true });
    await engine.start();
    const d = widgetData(engine);
    engine.stop();
    expect(d.v).toBe(1);
    expect(d.needs).toBe(1);
    expect(d.sessions[0]).toMatchObject({ folder: "api", status: "awaiting_approval", needsYou: true, word: "needs your OK" });
    expect(d.sessions[0]!.reason).not.toContain("\n");
    expect(d.sessions[1]).toMatchObject({ folder: "site", needsYou: false, task: "Make the homepage faster" });
    expect(d.fiveHourPct).toBeNull(); // unknown stays unknown
  });
});

describe.runIf(process.platform === "darwin")("menu-bar widget install/uninstall (sandboxed HOME)", () => {
  const realHome = process.env.HOME;
  let home: string;
  beforeEach(() => {
    home = tmpDir();
    process.env.HOME = home; // os.homedir() → sandbox: ~/Applications, ~/Library/LaunchAgents, ~/.Trash
  });
  afterEach(() => {
    process.env.HOME = realHome;
  });

  it("installs into ~/Applications with a login item, then removes everything to the Trash", () => {
    // a fake app bundle zipped like the real one
    const src = tmpDir();
    const app = path.join(src, "BuildPilot Bar.app", "Contents", "MacOS");
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(path.join(app, "BuildPilot Bar"), "#!/bin/sh\n", { mode: 0o755 });
    const zip = path.join(src, "bar.zip");
    execFileSync("/usr/bin/ditto", ["-c", "-k", "--keepParent", path.join(src, "BuildPilot Bar.app"), zip]);
    const cliDir = tmpDir();
    fs.writeFileSync(path.join(cliDir, "cli.js"), "// cli");
    const bpHome = path.join(home, ".buildpilot");

    const r = installWidget({ zip, cliDir, runtime: { node: "/usr/bin/true", electronAsNode: false }, startAtLogin: true, home: bpHome, launch: false });
    expect(r.appPath).toBe(path.join(home, "Applications", "BuildPilot Bar.app"));
    expect(fs.statSync(path.join(r.appPath, "Contents/MacOS/BuildPilot Bar")).mode & 0o111).toBeTruthy();
    expect(fs.readFileSync(path.join(home, "Library/LaunchAgents/com.buildpilot.bar.plist"), "utf8")).toContain(r.appPath);
    expect(JSON.parse(fs.readFileSync(path.join(bpHome, "widget-config.json"), "utf8"))).toMatchObject({ node: "/usr/bin/true", cli: path.join(bpHome, "bin", "cli.js") });
    expect(fs.existsSync(path.join(bpHome, "bin", "cli.js"))).toBe(true);
    expect(widgetStatus()).toMatchObject({ installed: true, startAtLogin: true });

    // reinstall is an in-place upgrade
    installWidget({ zip, cliDir, runtime: { node: "/usr/bin/true", electronAsNode: false }, startAtLogin: false, home: bpHome, launch: false });
    expect(widgetStatus()).toMatchObject({ installed: true, startAtLogin: false });

    const u = uninstallWidget(bpHome);
    expect(u.removed.length).toBeGreaterThan(0);
    expect(fs.existsSync(r.appPath)).toBe(false);
    expect(fs.existsSync(path.join(home, ".Trash", "BuildPilot Bar.app"))).toBe(true);
    expect(fs.existsSync(path.join(bpHome, "widget-config.json"))).toBe(false);
    expect(widgetStatus().installed).toBe(false);
  });
});
