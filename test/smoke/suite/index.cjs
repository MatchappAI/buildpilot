// Runs inside the real VS Code extension host.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const t = Date.now();
  while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await wait(200); }
  throw new Error("timed out waiting");
}

exports.run = async function () {
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push(`ok   ${name}`); }
    catch (e) { results.push(`FAIL ${name}: ${e.message}`); }
  };
  const ext = vscode.extensions.all.find((e) => e.packageJSON.name === "buildpilot");
  await check("extension found", () => assert.ok(ext));
  const api = await ext.activate();
  await check("extension activates", () => assert.ok(ext.isActive));
  const engine = await until(() => { const e = api.engine(); return e && e.store && e.currentProject ? e : null; });
  await check("engine started with SQLite", () => assert.ok(engine.store.schemaVersion >= 3));
  await check("workspace opened as project", () => assert.strictEqual(path.basename(engine.currentProject.root), path.basename(process.env.BP_SMOKE_WS)));
  await until(() => engine.snapshot().facts);
  await check("repository analyzed", () => assert.strictEqual(engine.snapshot().facts.name, "smoke-app"));
  const cmds = await vscode.commands.getCommands(true);
  for (const c of ["buildpilot.focus", "buildpilot.installHooks", "buildpilot.newPrompt", "buildpilot.copyHandoff", "buildpilot.checkpoint", "buildpilot.loadDemo"]) {
    await check(`command ${c} registered`, () => assert.ok(cmds.includes(c)));
  }
  await check("one-page view opens as an editor tab (no sidebar)", async () => { await vscode.commands.executeCommand("buildpilot.focus"); await wait(800); assert.ok(vscode.window.tabGroups.all.some((g) => g.tabs.some((t) => t.label === "BuildPilot")), "BuildPilot tab not found"); const pkg = require(require("path").join(__dirname, "../../../package.json")); assert.ok(!pkg.contributes.viewsContainers && !pkg.contributes.views, "sidebar still contributed"); });
  await check("hooks not installed in isolated config → recommendation shown", () => assert.ok(engine.snapshot().out.recommendations.some((r) => r.key === "hooks-missing")));
  // simulate a Claude Code hook event arriving via the spool exactly as hook.sh writes it
  const spool = path.join(process.env.BUILDPILOT_HOME, "spool");
  fs.writeFileSync(path.join(spool, "evt.smoke1.json"), JSON.stringify({ session_id: "smoke-session-1", cwd: engine.currentProject.root, hook_event_name: "UserPromptSubmit", prompt: "add a footer" }));
  await check("hook event ingested live via spool watcher", async () => { await until(() => engine.snapshot().out.sessions.some((s) => s.id === "smoke-session-1")); });
  await check("session status running", () => assert.strictEqual(engine.snapshot().out.sessions[0].displayStatus, "running"));
  await check("prompt studio builds prompt", () => { const p = engine.prompt({ goal: "feature", request: "Add a footer with a contact link" }); assert.ok(p.text.includes("## Done means")); });
  await check("demo data loads and is labelled", async () => { await vscode.commands.executeCommand("buildpilot.loadDemo"); assert.ok(engine.snapshot().demo); assert.ok(engine.snapshot().out.sessions.some((s) => s.id.startsWith("demo-"))); });
  await check("demo produces supervisor findings (loop + approval)", () => { const st = engine.snapshot(); assert.ok(st.out.issues.some((i) => i.key.startsWith("loop:demo-"))); assert.ok(st.out.recommendations.some((r) => r.key.startsWith("approve:demo-"))); });
  await check("demo data removable", async () => { await vscode.commands.executeCommand("buildpilot.clearDemo"); assert.ok(!engine.snapshot().out.sessions.some((s) => s.id.startsWith("demo-"))); });
  await check("every contributed command (palette, menus, walkthrough) is registered", async () => {
    const pkg = vscode.extensions.getExtension((({ publisher, name }) => `${publisher}.${name}`)(require("../../../package.json"))).packageJSON.contributes;
    const all = await vscode.commands.getCommands(true);
    const wanted = new Set([...pkg.commands.map((c) => c.command), ...JSON.stringify(pkg.walkthroughs ?? []).matchAll(/command:(buildpilot\.[a-zA-Z]+)/g)].map((x) => (Array.isArray(x) ? x[1] : x)));
    const missing = [...wanted].filter((c) => !all.includes(c));
    assert.deepStrictEqual(missing, []);
    assert.ok(wanted.size >= 20);
  });
  await check("safe commands run without error (refresh, brief, newPrompt, walkthrough)", async () => {
    for (const c of ["buildpilot.refresh", "buildpilot.newPrompt", "buildpilot.focus", "buildpilot.walkthrough"]) await vscode.commands.executeCommand(c);
  });
  await check("Integration API + Pocket start from settings", async () => {
    await vscode.workspace.getConfiguration("buildpilot").update("integrationApi.port", 47911, vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration("buildpilot").update("integrationApi.enabled", true, vscode.ConfigurationTarget.Global);
    const res = await until(async () => { try { const r = await fetch("http://127.0.0.1:47911/pocket"); return r.ok ? r : null; } catch { return null; } });
    assert.ok((await res.text()).includes("BuildPilot Pocket"));
    const unauth = await fetch("http://127.0.0.1:47911/v1/brief");
    assert.strictEqual(unauth.status, 401);
    const token = fs.readFileSync(path.join(process.env.BUILDPILOT_HOME, "api-token"), "utf8").trim();
    const brief = await (await fetch("http://127.0.0.1:47911/v1/brief?format=text", { headers: { authorization: `Bearer ${token}` } })).text();
    assert.ok(brief.includes("smoke-app"), brief);
  });
  await check("statusline data appears on the session", async () => {
    fs.mkdirSync(path.join(process.env.BUILDPILOT_HOME, "status"), { recursive: true });
    fs.writeFileSync(path.join(process.env.BUILDPILOT_HOME, "status", "smoke-session-1.json"), JSON.stringify({ session_id: "smoke-session-1", context_window: { used_percentage: 87, context_window_size: 200000 } }));
    const st = engine.snapshot();
    assert.strictEqual(st.live["smoke-session-1"].contextPct, 87);
    assert.ok(st.out.recommendations.some((r) => r.key === "context:smoke-session-1"));
  });
  await check("checkpoint works on a repo with no commits", async () => { const cp = await engine.checkpoint("smoke"); assert.ok(cp.sha.length === 40); });
  console.log("\n" + results.join("\n") + "\n");
  if (results.some((r) => r.startsWith("FAIL"))) throw new Error("smoke checks failed");
};
