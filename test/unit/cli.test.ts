import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { makeRepo, tmpDir } from "./helpers";

// Runs the shipped CLI (plugin/bin/cli.js, kept in sync with dist by `npm run build`) in a throwaway home.
const cli = path.join(__dirname, "..", "..", "plugin", "bin", "cli.js");

function bp(args: string[], cwd = tmpDir()): { out: string; code: number | null } {
  const home = tmpDir("bp-home-");
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", env: { ...process.env, HOME: home, BUILDPILOT_HOME: path.join(home, ".buildpilot"), NO_COLOR: "1" }, timeout: 20000 });
  return { out: `${r.stdout}${r.stderr}`.replace(/^.*ExperimentalWarning.*\n|^\(Use `node --trace-warnings.*\n/gm, ""), code: r.status };
}

describe("bp command line", () => {
  it("rejects unknown commands before doing any work, and suggests the near one", () => {
    const r = bp(["toady"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain('Unknown command "toady"');
    expect(r.out).toContain("Did you mean bp today?");
    expect(r.out).not.toContain("doesn't look like a project folder");
  });

  it("answers -h and --version", () => {
    expect(bp(["-h"]).out).toContain("Everyday");
    const v = bp(["--version"]);
    expect(v.code).toBe(0);
    expect(v.out).toMatch(/^BuildPilot \d+\.\d+\.\d+/);
  });

  it("explains how to connect when nothing is connected (bp, bp today, bp limits)", () => {
    for (const args of [[], ["today"], ["limits"]]) expect(bp(args).out, args.join(" ")).toContain("isn't connected to Claude Code yet");
  });

  it("bp done and bp prompt auto without their argument print usage", () => {
    const repo = makeRepo({ "package.json": "{}" });
    const d = bp(["done"], repo);
    expect(d.code).toBe(2);
    expect(d.out).toContain("Usage: bp done <name>");
    expect(d.out).not.toContain('called ""');
    const p = bp(["prompt", "auto"], repo);
    expect(p.code).toBe(2);
    expect(p.out).toContain('Usage: bp prompt auto "');
  });

  it("names the side build it couldn't find", () => {
    const repo = makeRepo({ "package.json": "{}" });
    expect(bp(["merge", "nope"], repo).out).toContain('No side build called "nope"');
  });

  it("an explicit command outside a project says which command to rerun", () => {
    const r = bp(["brief"], tmpDir());
    expect(r.code).toBe(2);
    expect(r.out).toContain("run bp brief again");
    expect(fs.existsSync(cli)).toBe(true);
  });
});
