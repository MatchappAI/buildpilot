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

describe("plugin commands never run user text as shell", () => {
  const dir = path.join(__dirname, "..", "..", "plugin", "commands");
  it("no $ARGUMENTS inside double quotes or bare in a ! line (backticks/$() in plain English would run)", () => {
    for (const f of fs.readdirSync(dir)) {
      const md = fs.readFileSync(path.join(dir, f), "utf8");
      for (const line of md.split("\n").filter((l) => l.includes("$ARGUMENTS") && /sh "\$\{CLAUDE_PLUGIN_ROOT\}/.test(l))) {
        expect(line, f).toMatch(/'\$ARGUMENTS'/);
      }
    }
    const p = fs.readFileSync(path.join(dir, "bp-prompt.md"), "utf8");
    expect(p).not.toMatch(/!`[^`]*\$ARGUMENTS/);
    expect(p).toContain("--stdin <<'BP_REQUEST_END_7c41'");
  });

  it("bp prompt auto --stdin treats backticks, $( ) and quotes as plain text", () => {
    const repo = makeRepo({ "package.json": JSON.stringify({ name: "x", scripts: { test: "node -e 0" } }) });
    const home = tmpDir("bp-home-");
    const marker = path.join(home, "pwned");
    const hostile = `make the \`touch ${marker}\` "Save" button $(touch ${marker}) blue`;
    const r = spawnSync("sh", [path.join(__dirname, "..", "..", "plugin", "bin", "bp.sh"), "prompt", "auto", "--stdin"], { cwd: repo, input: hostile, encoding: "utf8", env: { ...process.env, HOME: home, BUILDPILOT_HOME: path.join(home, ".buildpilot"), NO_COLOR: "1" }, timeout: 20000 });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Save");
    expect(fs.existsSync(marker)).toBe(false);
  });
});

describe("spool", () => {
  it("unreadable events are kept only as a short, redacted copy", async () => {
    const home = tmpDir();
    fs.mkdirSync(path.join(home, "spool", "tmp"), { recursive: true });
    fs.writeFileSync(path.join(home, "spool", "evt.bad.json"), `{"prompt":"my key sk-ant-api03-${"Q".repeat(40)}" ${"x".repeat(20000)}`);
    const engine = new Engine({ home, light: true, claudeSettingsFile: path.join(home, "s.json") });
    await engine.start();
    engine.stop();
    const rej = path.join(home, "spool", "rejected");
    const kept = fs.readdirSync(rej);
    expect(kept).toHaveLength(1);
    const body = fs.readFileSync(path.join(rej, kept[0]!), "utf8");
    expect(body).not.toContain("sk-ant-api03-QQQQ");
    expect(body.length).toBeLessThanOrEqual(4000);
    expect(fs.existsSync(path.join(home, "spool", "evt.bad.json"))).toBe(false);
  });
});

describe("bp ui", () => {
  it("never stops an unrelated process named by a stale ui-server.json (recycled pid)", async () => {
    const { spawn } = await import("child_process");
    const home = tmpDir("bp-home-");
    const bph = path.join(home, ".buildpilot");
    fs.mkdirSync(bph, { recursive: true });
    const victim = spawn("sleep", ["30"], { stdio: "ignore" });
    fs.writeFileSync(path.join(bph, "ui-server.json"), JSON.stringify({ port: 9, token: "x", pid: victim.pid, version: "0.0.1" }));
    const r = spawnSync(process.execPath, [cli, "ui", "--print"], { cwd: home, encoding: "utf8", env: { ...process.env, HOME: home, BUILDPILOT_HOME: bph, NO_COLOR: "1" }, timeout: 20000 });
    let alive = true;
    try { process.kill(victim.pid!, 0); } catch { alive = false; }
    // stop the window server this test started
    try { process.kill((JSON.parse(fs.readFileSync(path.join(bph, "ui-server.json"), "utf8")) as { pid: number }).pid, "SIGTERM"); } catch { /* none */ }
    victim.kill();
    expect(alive).toBe(true);
    expect(r.stdout).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?c=[0-9a-f]+/);
  });

  it("the project picker only opens folders BuildPilot knows", async () => {
    const home = tmpDir();
    const engine = new Engine({ home, inMemory: true, claudeSettingsFile: path.join(home, "s.json") });
    await engine.start();
    const known = makeRepo({ "package.json": "{}" });
    await engine.openProject(known);
    const srv = new UiServer(engine, { media: path.join(__dirname, "../../media") });
    const stranger = makeRepo({ "package.json": "{}" });
    expect(await srv.onMessage({ type: "selectProject", root: stranger })).toEqual({ flash: "BuildPilot doesn't know that folder" });
    expect(engine.currentProject?.root).toBe(fs.realpathSync(known));
    expect(await srv.onMessage({ type: "selectProject", root: known })).toBeNull();
    engine.stop();
  });
});

describe("side builds in the window", () => {
  it("their change counts refresh on their own while the window is open (not only after a click)", async () => {
    const home = tmpDir();
    const engine = new Engine({ home, inMemory: true, claudeSettingsFile: path.join(home, "s.json") });
    await engine.start();
    await engine.openProject(makeRepo({ "package.json": "{}" }));
    const srv = new UiServer(engine, { media: path.join(__dirname, "../../media") });
    const w = await engine.createWorktree("later");
    const side = () => (srv as unknown as { statePayload(): { page: { side: { name: string; changed: number }[] } } }).statePayload().page.side;
    // Wait for the background refresh itself (git can be slow when the machine is busy), never a fixed time.
    const changed = () => side().find((x) => x.name === path.basename(w.dir))?.changed;
    const until = async (cond: () => boolean) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > 20_000) throw new Error("side builds never refreshed"); await new Promise((r) => setTimeout(r, 20)); } };
    side(); // first read starts a refresh in the background
    await until(() => changed() === 0);
    fs.writeFileSync(path.join(w.dir, "new.txt"), "hi");
    (srv as unknown as { sideAt: number }).sideAt = 0; // as if 5 s passed
    side(); // no click: just reading the page starts the refresh
    await until(() => changed() === 1);
    expect(changed()).toBe(1);
    engine.stop();
  }, 30_000);
});
