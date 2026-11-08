import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { HOOK_SCRIPT } from "../../src/core/hooks";
import { tips, TipInput } from "../../src/core/tips";
import { tmpDir } from "./helpers";

const root = path.resolve(__dirname, "..", "..");
const plugin = path.join(root, "plugin");
const spool = (home: string) => path.join(home, "spool");
const events = (home: string) => (fs.existsSync(spool(home)) ? fs.readdirSync(spool(home)).filter((f) => f.endsWith(".json")) : []);

describe("plugin package", () => {
  it("ships the database fallback and the Node-checking launcher next to cli.js", () => {
    for (const f of ["cli.js", "sql-wasm.wasm", "bp.sh"]) expect(fs.existsSync(path.join(plugin, "bin", f)), f).toBe(true);
  });
  it("every slash command runs through bp.sh (never node directly)", () => {
    for (const f of fs.readdirSync(path.join(plugin, "commands"))) {
      const md = fs.readFileSync(path.join(plugin, "commands", f), "utf8");
      expect(md, f).not.toMatch(/bin\/cli\.js/);
      if (md.includes("!`")) expect(md, f).toMatch(/allowed-tools: Bash\(sh:\*\)/);
    }
  });
  it("bp.sh prints one plain sentence when Node is missing", () => {
    const out = execFileSync("/bin/sh", [path.join(plugin, "bin", "bp.sh"), "limits"], { env: { PATH: "/nonexistent", HOME: tmpDir() } }).toString();
    expect(out).toMatch(/needs Node\.js/);
    expect(out.split("\n").filter(Boolean)).toHaveLength(1);
  });
});

describe("spool hooks (plugin spool.sh and settings hook.sh)", () => {
  const scripts = (): [string, string][] => {
    const settingsHook = path.join(tmpDir(), "hook.sh");
    fs.writeFileSync(settingsHook, HOOK_SCRIPT);
    return [["plugin", path.join(plugin, "hooks", "spool.sh")], ["settings", settingsHook]];
  };
  const prep = (home: string) => fs.mkdirSync(path.join(spool(home), "tmp"), { recursive: true });
  const fire = (script: string, home: string, ev = "Stop") => execFileSync("sh", [script], { input: `{"hook_event_name":"${ev}"}`, env: { ...process.env, BUILDPILOT_HOME: home } });

  for (const [name, script] of scripts()) {
    it(`${name}: first event starts the 2-day clock and the folder is owner-only`, () => {
      const home = path.join(tmpDir(), "h");
      prep(home);
      fire(script, home);
      expect(fs.existsSync(path.join(spool(home), ".alive"))).toBe(true);
      expect(events(home)).toHaveLength(1);
      const f = path.join(spool(home), events(home)[0]!);
      expect(fs.statSync(f).mode & 0o077).toBe(0);
    });
    it(`${name}: past 2000 unread events drops tool steps but keeps status changes`, () => {
      const home = path.join(tmpDir(), "h");
      prep(home);
      fs.writeFileSync(path.join(spool(home), ".alive"), "");
      for (let i = 0; i < 2001; i++) fs.writeFileSync(path.join(spool(home), `e${i}.json`), "{}");
      fire(script, home, "PreToolUse");
      expect(events(home)).toHaveLength(2001);
      fire(script, home, "Stop");
      fire(script, home, "PermissionRequest");
      expect(events(home)).toHaveLength(2003);
      expect(fs.readdirSync(path.join(spool(home), "tmp"))).toHaveLength(0); // nothing left half-written
    });
    it(`${name}: hard stop at 5000 unread events`, () => {
      const home = path.join(tmpDir(), "h");
      prep(home);
      fs.writeFileSync(path.join(spool(home), ".alive"), "");
      for (let i = 0; i < 5001; i++) fs.writeFileSync(path.join(spool(home), `e${i}.json`), "{}");
      fire(script, home, "Stop");
      expect(events(home)).toHaveLength(5001);
    });
    it(`${name}: stops writing when nothing has read the spool for 2 days`, () => {
      const home = path.join(tmpDir(), "h");
      prep(home);
      const alive = path.join(spool(home), ".alive");
      fs.writeFileSync(alive, "");
      const old = new Date(Date.now() - 3 * 86_400_000);
      fs.utimesSync(alive, old, old);
      fire(script, home);
      expect(events(home)).toHaveLength(0);
    });
  }
});

describe("double-hooks tip", () => {
  const base: TipInput = { now: Date.now(), builds: [], limits: { fiveHourPct: 20, sevenDayPct: 10, fullAt: null, fiveHourResetsAt: null }, isGit: true, unsaved: 0, stuck: [] };
  it("appears only when the plugin and settings hooks are both on, with a one-click fix", () => {
    expect(tips(base).find((t) => t.key === "doublehooks")).toBeUndefined();
    const t = tips({ ...base, doubleHooks: true })[0]!;
    expect(t.key).toBe("doublehooks");
    expect(t.action).toBe("fixDoubleHooks");
  });
});
