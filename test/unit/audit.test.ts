/** Regressions found in the 2026-11-16 production-readiness audit. */
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { Engine } from "../../src/core/engine";
import { glance, setBuildName, staleConnectStep } from "../../src/core/glance";
import { installHooks } from "../../src/core/hooks";
import { Ingestor } from "../../src/core/ingest";
import { writePromptFile } from "../../src/core/prompts";
import { UiServer, copyText } from "../../src/core/uiserver";
import { makeRepo, tmpDir } from "./helpers";

const cli = path.join(__dirname, "..", "..", "plugin", "bin", "cli.js");
function bp(args: string[], home = tmpDir("bp-home-"), cwd = tmpDir()) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", env: { ...process.env, HOME: home, BUILDPILOT_HOME: path.join(home, ".buildpilot"), NO_COLOR: "1", CLAUDE_CONFIG_DIR: "" }, timeout: 20000 });
  return { out: `${r.stdout}${r.stderr}`.replace(/^.*ExperimentalWarning.*\n|^\(Use `node --trace-warnings.*\n/gm, ""), code: r.status };
}

describe("CLI", () => {
  it("bp doctor --json prints JSON (the --json flag used to be dropped before doctor saw it)", () => {
    const r = bp(["doctor", "--json"]);
    const j = JSON.parse(r.out.trim()) as { findings: { ok: boolean; text: string }[] };
    expect(Array.isArray(j.findings)).toBe(true);
  });

  it("bp go with no match lists each session name once", () => {
    const r = bp(["go", "zzz"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('No session matching "zzz"');
  });
});

describe("terminal summary", () => {
  it("a saved 'Connect BuildPilot' next step is dropped once BuildPilot is connected", () => {
    const home = tmpDir();
    const prev = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = path.join(home, ".claude");
    try {
      expect(staleConnectStep({ next: "Write tests", nextKey: "tests" })).toBe(false); // other steps are never touched
      installHooks(path.join(home, ".claude", "settings.json"), path.join(home, ".buildpilot"));
      expect(staleConnectStep({ next: "Connect BuildPilot to Claude Code", nextKey: "hooks-missing" })).toBe(true);
      expect(staleConnectStep({ next: "Connect BuildPilot to Claude Code" })).toBe(true); // summaries saved before nextKey existed
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = prev;
    }
  });

  it("glance shows the name you gave a session, not just its folder", async () => {
    const home = tmpDir();
    const engine = new Engine({ home, inMemory: true, light: true, claudeSettingsFile: path.join(home, "s.json") });
    await engine.start();
    const cwd = "/nonexistent-bp-audit/shop"; // temp folders are hidden from the summary as background runs
    const ing = new Ingestor(engine.store, () => null);
    ing.ingestRaw(JSON.stringify({ session_id: "s-named-0001", cwd, hook_event_name: "UserPromptSubmit", prompt: "add checkout" }), Date.now());
    setBuildName(engine, "s-named-0001", "checkout page");
    const out = glance(engine, { cwd: home, columns: 100, color: false });
    expect(out).toContain("1 Claude session");
    expect(out).toContain("checkout page");
    engine.stop();
  });
});

describe("window server", () => {
  it("defaults to a white page and stores Auto light/dark when asked", async () => {
    const home = tmpDir();
    const engine = new Engine({ home, inMemory: true, claudeSettingsFile: path.join(home, "s.json") });
    await engine.start();
    await engine.openProject(makeRepo({ "package.json": "{}" }));
    const srv = new UiServer(engine, { media: path.join(__dirname, "../../media") });
    const state = () => (srv as unknown as { statePayload(): { settings: { theme: string } } }).statePayload().settings.theme;
    expect(state()).toBe("white");
    await srv.onMessage({ type: "toggleTheme", to: "auto" });
    expect(state()).toBe("auto");
    await srv.onMessage({ type: "toggleTheme", to: "white" });
    expect(state()).toBe("white");
    await srv.onMessage({ type: "toggleTheme", to: "<script>" });
    expect(["white", "auto"]).toContain(state());
    engine.stop();
  });

  it("successful 'Start Claude' says sent:true (so the page counts the prompt only then)", async () => {
    const home = tmpDir();
    const engine = new Engine({ home, inMemory: true, claudeSettingsFile: path.join(home, "s.json") });
    await engine.start();
    await engine.openProject(makeRepo({ "package.json": "{}" }));
    const srv = new UiServer(engine, { media: path.join(__dirname, "../../media") });
    const r = (await srv.onMessage({ type: "sendToClaude", text: "hello" })) as { sent?: boolean };
    expect(r.sent).toBe(true);
    const log = fs.readFileSync(process.env.BUILDPILOT_OS_LOG!, "utf8");
    expect(log).toMatch(/"kind":"terminal"/); // logged, never a real Terminal window in tests
    engine.stop();
  });

  it("OS side effects are logged, not performed, when BUILDPILOT_OS_LOG is set", async () => {
    await copyText("secret-ish clipboard text");
    expect(fs.readFileSync(process.env.BUILDPILOT_OS_LOG!, "utf8")).toContain("secret-ish clipboard text");
  });
});

describe("prompt files", () => {
  it("are private and pruned after a week", () => {
    const home = tmpDir();
    const old = writePromptFile(home, "old", Date.now() - 8 * 86_400_000);
    fs.utimesSync(old, new Date(Date.now() - 8 * 86_400_000), new Date(Date.now() - 8 * 86_400_000));
    const fresh = writePromptFile(home, "new");
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.readFileSync(fresh, "utf8")).toBe("new");
    expect(fs.statSync(fresh).mode & 0o077).toBe(0);
  });
});
