import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { IntegrationApi, loadOrCreateToken } from "../../src/core/api";
import { Engine } from "../../src/core/engine";
import { makeRepo, tmpDir } from "./helpers";

let engines: Engine[] = [];
afterEach(() => {
  engines.forEach((e) => e.stop());
  engines = [];
});

async function setup(files: Record<string, string> = {}): Promise<{ engine: Engine; repo: string; home: string }> {
  const home = tmpDir("bp-home-");
  const engine = new Engine({ home, inMemory: true, claudeSettingsFile: path.join(home, "claude-settings.json") });
  engines.push(engine);
  await engine.start();
  const repo = makeRepo({ "package.json": JSON.stringify({ name: "demo", scripts: { test: "node -e \"process.exit(0)\"", fail: "node -e \"process.exit(3)\"" } }), "src/index.js": "console.log(1)\n", ...files });
  fs.mkdirSync(path.join(repo, "node_modules"));
  await engine.openProject(repo);
  return { engine, repo, home };
}

function spool(home: string, name: string, obj: Record<string, unknown>): void {
  fs.writeFileSync(path.join(home, "spool", name), JSON.stringify(obj));
}

describe("engine end-to-end", () => {
  it("associates sessions with the open project and switches projects cleanly", async () => {
    const { engine, repo, home } = await setup();
    spool(home, "1.json", { session_id: "abc12345", cwd: path.join(repo, "src"), hook_event_name: "UserPromptSubmit", prompt: "add tests" });
    spool(home, "2.json", { session_id: "zzz", cwd: "/somewhere/else", hook_event_name: "UserPromptSubmit", prompt: "other" });
    engine.drainNow();
    const st = engine.snapshot();
    expect(st.out.sessions.map((s) => s.id)).toEqual(["abc12345"]);
    expect(st.out.sessions[0]!.displayStatus).toBe("running");
    expect(st.integration.otherProjectSessions).toBe(1);
    const repo2 = makeRepo({ "a.py": "print(1)\n" });
    await engine.openProject(repo2);
    expect(engine.snapshot().out.sessions).toEqual([]);
    expect(engine.snapshot().facts?.languages).toEqual([]);
  });

  it("links sessions whose cwd is the real path of a symlinked project folder (macOS /var vs /private/var)", async () => {
    const { engine, repo, home } = await setup();
    const link = path.join(tmpDir("bp-link-"), "proj-link");
    fs.symlinkSync(repo, link);
    await engine.openProject(link);
    spool(home, "r.json", { session_id: "real1", cwd: fs.realpathSync(repo), hook_event_name: "SessionStart", source: "startup" });
    engine.drainNow();
    expect(engine.snapshot().out.sessions.map((s) => s.id)).toEqual(["real1"]);
  });

  it("shows active sessions from other projects (mission control across folders) and mentions them in the brief", async () => {
    const { engine, home } = await setup();
    spool(home, "o1.json", { session_id: "other1", cwd: "/work/shop-app", hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "npm publish" } });
    spool(home, "o2.json", { session_id: "demo-x", cwd: "/work/ignored", hook_event_name: "UserPromptSubmit", prompt: "x" });
    engine.drainNow();
    const st = engine.snapshot();
    expect(st.elsewhere.map((s) => [s.folder, s.status])).toEqual([["shop-app", "awaiting_approval"]]);
    expect(engine.brief(st)).toMatch(/Also waiting for you in shop-app/);
  });

  it("recommends hook setup when Claude Code isn't connected", async () => {
    const { engine } = await setup();
    const st = engine.snapshot();
    expect(st.hooks.installed).toBe(false);
    expect(st.out.recommendations.some((r) => r.key === "hooks-missing")).toBe(true);
  });

  it("runs only named scripts, records results, and uses them as evidence", async () => {
    const { engine } = await setup();
    await expect(engine.runScript("rm -rf /")).rejects.toThrow(/No script named/);
    const ok = await engine.runScript("test");
    expect(ok.passed).toBe(true);
    engine.addRequirement("Users can log in", "login page accepts valid credentials");
    const id = engine.requirements()[0]!.id;
    engine.updateRequirement(id, { status: "done" });
    expect(engine.requirements()[0]!.evidence).toBe("verified");
    const bad = await engine.runScript("fail");
    expect(bad.passed).toBe(false);
    expect(bad.exitCode).toBe(3);
    const st = engine.snapshot();
    expect(st.out.issues.some((i) => i.key === "tests-failing")).toBe(false); // "fail" isn't a test command
    expect(st.out.readiness.find((r) => r.key === "tests")?.status).toBe("verified");
  });

  it("marks hand-checked requirements unverified when there's no passing test", async () => {
    const { engine } = await setup();
    engine.addRequirement("Export CSV");
    engine.updateRequirement(engine.requirements()[0]!.id, { status: "done" });
    expect(engine.requirements()[0]!.evidence).toBe("unverified");
    expect(engine.snapshot().out.progress.done).toBe(0);
  });

  it("creates a handoff and prompts that include project memory, without secrets", async () => {
    const { engine } = await setup();
    engine.setNote("goal", "Invoice app for freelancers");
    engine.addDecision("Use Postgres", "Supabase hosted");
    const h = engine.handoff();
    expect(h).toContain("Invoice app for freelancers");
    expect(h).toContain("Use Postgres");
    const p = engine.prompt({ goal: "handoff", request: "" });
    expect(p.text).toContain("<project_data>");
    expect(p.text).toContain("Use Postgres");
  });

  it("serves the integration API only with a valid token", async () => {
    const { engine, home } = await setup();
    const token = loadOrCreateToken(home);
    expect(fs.statSync(path.join(home, "api-token")).mode & 0o077).toBe(0);
    const api = new IntegrationApi(engine, { port: 47999, host: "127.0.0.1", token });
    await api.start();
    try {
      expect((await fetch("http://127.0.0.1:47999/v1/brief")).status).toBe(401);
      expect((await fetch("http://127.0.0.1:47999/v1/brief", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
      const r = await fetch("http://127.0.0.1:47999/v1/brief?format=text", { headers: { authorization: `Bearer ${token}` } });
      expect(r.status).toBe(200);
      expect(await r.text()).toMatch(/demo/);
      const p = await fetch("http://127.0.0.1:47999/v1/prompt", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ goal: "bugfix", request: "login button does nothing on mobile" }) });
      expect(((await p.json()) as { prompt: string }).prompt).toContain("Fix a bug");
      const s = await fetch("http://127.0.0.1:47999/v1/status", { headers: { authorization: `Bearer ${token}` } });
      expect(((await s.json()) as { project: string }).project).toBe("demo");
    } finally {
      await api.stop();
    }
  });

  it("emits a meaningful alert when a session needs approval, and only once", async () => {
    const { engine, repo, home } = await setup();
    const alerts: string[] = [];
    engine.on("alert", (a: { title: string }) => alerts.push(a.title));
    spool(home, "1.json", { session_id: "s9", cwd: repo, hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "npm publish" } });
    engine.drainNow();
    await new Promise((r) => setTimeout(r, 450));
    engine.drainNow();
    await new Promise((r) => setTimeout(r, 450));
    expect(alerts).toEqual(["Claude needs your approval"]);
  });
});
