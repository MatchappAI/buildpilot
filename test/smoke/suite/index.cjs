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
  await check("sidebar view opens", async () => { await vscode.commands.executeCommand("buildpilot.main.focus"); await wait(800); });
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
  await check("checkpoint works on a repo with no commits", async () => { const cp = await engine.checkpoint("smoke"); assert.ok(cp.sha.length === 40); });
  console.log("\n" + results.join("\n") + "\n");
  if (results.some((r) => r.startsWith("FAIL"))) throw new Error("smoke checks failed");
};
