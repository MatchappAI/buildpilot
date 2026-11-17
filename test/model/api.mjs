// The window server's API (/api/msg, /api/state) and the side-build CLI, driven over HTTP / child processes against the
// REAL `bp ui --serve` on a throwaway HOME. A shadow model predicts every effect; after every step the server, the files
// it owns (settings.json, ui.json, usage.json, license.json) and git must agree with it, and a refused action must change
// nothing at all.
import fs from "fs"; import path from "path"; import os from "os"; import crypto from "crypto";
import { spawn, execFileSync } from "child_process";
import { TEXT, WRONG, BODIES } from "./fuzz.mjs";
import { rng } from "./rng.mjs";

const sha = (f) => { try { return crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 16); } catch { return "-"; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Every step has a deadline: a hang is reported as a failure naming the action, never a silent stall. */
export const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error(`${what} hung for ${ms / 1000} s`)), ms).unref())]);

/** A throwaway HOME with a git project, the test CLI and a running window server. */
export async function makeServerWorld(B, cfg = {}) {
  const base = path.join(os.homedir(), process.platform === "darwin" ? "Library/Caches" : ".cache");
  const home = fs.mkdtempSync(path.join(base, "bp-model-api."));
  const env = { ...process.env, HOME: home, NO_COLOR: "1", BUILDPILOT_OS_LOG: path.join(home, "os.log"), NODE_NO_WARNINGS: "1" };
  for (const k of ["CLAUDE_CONFIG_DIR", "BUILDPILOT_HOME", "TMUX", "BUILDPILOT_LICENSE_KEY", "BUILDPILOT_AUTH_TOKEN", "BUILDPILOT_CHECKOUT_URL", "BUILDPILOT_TRIAL_DAYS", "BUILDPILOT_UI_PORT"]) delete env[k];
  if (cfg.sellable !== false) env.BUILDPILOT_CHECKOUT_URL = "https://buy.stripe.com/test_model";
  env.BUILDPILOT_TRIAL_DAYS = String(cfg.trialDays ?? 0);
  const proj = path.join(home, cfg.projName ?? "proj"); fs.mkdirSync(path.join(proj, "src"), { recursive: true });
  const git = (args, cwd = proj) => execFileSync("git", ["-c", "user.email=m@e", "-c", "user.name=m", ...args], { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  fs.writeFileSync(path.join(proj, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "node -e 0" } }));
  fs.writeFileSync(path.join(proj, "src/shared.txt"), "line 1\nline 2\nline 3\n");
  git(["init", "-q", "-b", "main"]); git(["add", "-A"]); git(["commit", "-qm", "init"]);
  const bph = path.join(home, ".buildpilot"); fs.mkdirSync(bph, { recursive: true, mode: 0o700 });
  if (cfg.count != null || cfg.firstRun != null) fs.writeFileSync(path.join(bph, "usage.json"), JSON.stringify({ installId: "model-install-0001", count: cfg.count ?? 0, firstRun: cfg.firstRun ?? Date.now() }));
  if (cfg.license) fs.writeFileSync(path.join(bph, "license.json"), JSON.stringify({ key: cfg.license }));
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  const settingsFile = path.join(home, ".claude/settings.json");
  const original = JSON.stringify({ model: "sonnet", statusLine: { type: "command", command: "echo mine" }, ...(cfg.plugin ? { enabledPlugins: { "buildpilot@buildpilot": true } } : {}) }, null, 2);
  fs.writeFileSync(settingsFile, original);
  const cli = (args, cwd = proj, input) => { const t = Date.now(); try { return { out: execFileSync("node", [B.cli, ...args], { cwd, env, encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"], timeout: 60_000 }), code: 0, ms: Date.now() - t }; } catch (e) { return { out: String(e.stdout ?? "") + String(e.stderr ?? ""), code: e.status ?? -1, ms: Date.now() - t, signal: e.signal }; } };
  let server = null, info = null;
  const start = async () => {
    const f = path.join(bph, "ui-server.json"); fs.rmSync(f, { force: true });
    server = spawn("node", [B.cli, "ui", "--serve", proj], { env, stdio: ["ignore", "ignore", "pipe"] });
    let err = ""; server.stderr.on("data", (d) => (err += d)); server.errText = () => err;
    for (let i = 0; i < 150 && !fs.existsSync(f); i++) await sleep(50);
    info = JSON.parse(fs.readFileSync(f, "utf8"));
  };
  const stop = async () => { if (!server) return; const s = server; server = null; s.kill("SIGTERM"); await new Promise((r) => (s.exitCode != null ? r() : s.on("exit", r))); };
  await start();
  const req = async (pathname, { method = "GET", body, headers = {} } = {}) => {
    let r;
    // One retry on a network error: Node's fetch can reuse a keep-alive socket the server is just closing (a client
    // race; browsers retry the same way). A server that is really down fails both.
    for (let attempt = 0; attempt < 2 && !r; attempt++) try { r = await fetch(`http://127.0.0.1:${info.port}${pathname}`, { method, body, signal: AbortSignal.timeout(90_000), headers: { "x-bp-token": info.token, ...(body != null ? { "content-type": "application/json" } : {}), ...headers } }); }
    catch (e) { if (attempt === 0) { await sleep(150); continue; } return { status: -1, text: `unreachable: ${e.cause?.code ?? e.message} (server ${server?.exitCode != null ? `exited ${server.exitCode}` : "running"})`, json: null }; }
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, text, json };
  };
  const msg = (m) => req("/api/msg", { method: "POST", body: JSON.stringify(m) });
  const state = async () => (await req("/api/state")).json;
  const osLog = () => { try { return fs.readFileSync(env.BUILDPILOT_OS_LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  return {
    home, bph, proj, env, git, cli, settingsFile, original, msg, req, state, osLog, start, stop,
    get info() { return info; }, get server() { return server; },
    cleanup: async () => { await stop(); fs.rmSync(home, { recursive: true, force: true }); },
  };
}

/** Everything a refused action must leave untouched. */
export function fingerprint(W) {
  const g = (a, cwd = W.proj) => { try { return W.git(a, cwd).trim(); } catch (e) { return `ERR ${String(e.stderr ?? e.message).slice(0, 60)}`; } };
  return JSON.stringify({
    settings: sha(W.settingsFile), ui: sha(path.join(W.bph, "ui.json")), usage: sha(path.join(W.bph, "usage.json")), license: sha(path.join(W.bph, "license.json")),
    head: g(["rev-parse", "HEAD"]), status: g(["status", "--porcelain"]), worktrees: g(["worktree", "list", "--porcelain"]), branches: g(["branch", "--list", "--format=%(refname:short)"]),
    files: fs.readdirSync(path.join(W.proj, "src")).sort(),
  });
}

const DAY = 86_400_000;
/** A request with exactly these headers (fetch won't let a caller set Host). */
async function rawPost(W, pathname, body, headers) {
  const http = await import("http");
  return new Promise((resolve, reject) => {
    const q = http.request({ host: "127.0.0.1", port: W.info.port, path: pathname, method: "POST", headers }, (res) => { let t = ""; res.on("data", (d) => (t += d)); res.on("end", () => resolve({ status: res.statusCode, text: t })); });
    q.on("error", reject); q.end(body);
  });
}
const isPro = (m) => m.licensed || m.trialLeft > 0 || !m.sellable;
const BAD_TEXT = /\bundefined\b|\bNaN\b|\[object Object\]/;

/**
 * The shadow model + action table. Each action: pre(m) (enabled?), run(W, m, R) → {res, expect}, where expect is
 * "refused" (fingerprint must not change) or "ok", plus check(res) for its own result.
 */
export function apiActions(B) {
  const known = (m) => [...m.builds.values()].filter((b) => b.state !== "removed");
  const pickBuild = (m, R, states) => { const xs = known(m).filter((b) => !states || states.includes(b.state)); return xs.length ? R.pick(xs) : null; };
  const A = {
    // ---------- plan / license ----------
    buildPrompt: { m: "plan", run: async (W, m, R) => { const [cls, t] = R.pick(TEXT); m.lastFuzz = cls; const r = await W.msg({ type: "buildPrompt", goal: R.pick(["feature", "bugfix", "nope", ""]), request: t, defer: true }); const pro = isPro(m); const ok = pro || m.count < 20; return { res: r, expect: "refused", check: () => (ok ? r.json?.result?.prompt?.text?.length > 50 : !!r.json?.result?.paywall) || `prompt/paywall wrong (pro=${pro}, count=${m.count}): ${r.text.slice(0, 120)}` }; } },
    promptUsed: { m: "plan", run: async (W, m) => { const r = await W.msg({ type: "promptUsed" }); const pro = isPro(m); if (!pro) m.count++; return { res: r, expect: pro ? "refused" : "ok", check: () => (pro ? r.json?.result === null : r.json?.result === Math.max(0, 20 - m.count)) || `promptUsed returned ${r.text}` }; } },
    "enterLicense:valid": { m: "plan", run: async (W, m) => { const r = await W.msg({ type: "enterLicense", key: B.mint() }); m.licensed = true; return { res: r, expect: "ok", check: () => /unlocked/.test(r.json?.result?.flash) || r.text }; } },
    "enterLicense:expired": { m: "plan", run: async (W) => { const r = await W.msg({ type: "enterLicense", key: B.mint({ sub: "x", plan: "pro", exp: Date.now() - 1000 }) }); return { res: r, expect: "refused", check: () => /expired/.test(r.json?.result?.flash) || r.text }; } },
    "enterLicense:forged": { m: "plan", run: async (W) => { const r = await W.msg({ type: "enterLicense", key: B.forge() }); return { res: r, expect: "refused", check: () => /signature/.test(r.json?.result?.flash) || r.text }; } },
    "enterLicense:fuzz": { m: "plan", run: async (W, m, R) => { const [cls, t] = R.pick([...TEXT, ...WRONG]); m.lastFuzz = cls; const r = await W.msg({ type: "enterLicense", key: t }); return { res: r, expect: "refused", check: () => /didn't work/.test(r.json?.result?.flash) || r.text }; } },
    upgrade: { m: "plan", run: async (W, m) => { const n = W.osLog().length; const r = await W.msg({ type: "upgrade" }); const o = W.osLog().slice(n); return { res: r, expect: "refused", check: () => (o.length === 1 && o[0].kind === "open" && /^https:\/\/buy\.stripe\.com\//.test(o[0].url)) || (!m.sellable && o.length === 1) || `upgrade opened ${JSON.stringify(o)}` }; } },
    trialEnds: { m: "plan", pre: (m) => m.trialLeft > 0, run: async (W, m) => { const f = path.join(W.bph, "usage.json"); const u = JSON.parse(fs.readFileSync(f, "utf8")); u.firstRun = Date.now() - 30 * DAY; fs.writeFileSync(f, JSON.stringify(u)); m.trialLeft = 0; return { res: null, expect: "env" }; } },
    // ---------- prefs ----------
    toggleTheme: { m: "prefs", run: async (W, m, R) => { const to = R.pick(["white", "auto", "match", "", "bogus", 7]); const r = await W.msg({ type: "toggleTheme", to }); m.theme = ["white", "auto", "match"].includes(to) ? to : m.theme === "white" ? "auto" : "white"; return { res: r, expect: "ok" }; } },
    toggleAlerts: { m: "prefs", run: async (W, m) => { const r = await W.msg({ type: "toggleAlerts" }); m.alerts = !m.alerts; return { res: r, expect: "ok", check: () => r.json?.result?.flash === (m.alerts ? "Alerts on" : "Alerts off") || r.text }; } },
    // ---------- connection ----------
    connectAll: { m: "connection", run: async (W, m) => { const r = await W.msg({ type: "connectAll" }); const again = m.connected; m.connected = true; return { res: r, expect: again ? "refused" : "ok" }; } },
    disconnect: { m: "connection", run: async (W, m) => { const r = await W.msg({ type: "disconnect" }); const was = m.connected; m.connected = false; return { res: r, expect: was ? "ok" : "refused", check: () => !was || m.plugin || JSON.stringify(JSON.parse(fs.readFileSync(W.settingsFile, "utf8"))) === JSON.stringify(JSON.parse(W.original)) || `settings after Disconnect differ from the user's original: ${fs.readFileSync(W.settingsFile, "utf8").slice(0, 200)}` }; } },
    fixDoubleHooks: { m: "connection", run: async (W, m) => { const r = await W.msg({ type: "fixDoubleHooks" }); const changes = m.plugin && m.connected; return { res: r, expect: changes ? "ok" : "refused", after: () => { if (changes) m.connectedHooksOnly = false; } }; } },
    showConnectChanges: { m: "connection", run: async (W) => { const r = await W.msg({ type: "showConnectChanges" }); return { res: r, expect: "refused", check: () => { try { return !!JSON.parse(r.json.result.show).hooks || r.text; } catch { return `preview isn't JSON: ${r.text.slice(0, 80)}`; } } }; } },
    // ---------- project ----------
    projects: { m: "project", run: async (W) => { const r = await W.msg({ type: "projects" }); return { res: r, expect: "refused", check: () => (Array.isArray(r.json?.result) && r.json.result.some((p) => p.root === W.proj)) || `picker misses the project: ${r.text.slice(0, 120)}` }; } },
    "selectProject:known": { m: "project", run: async (W) => { const r = await W.msg({ type: "selectProject", root: W.proj }); return { res: r, expect: "refused", check: () => r.json?.result === null || r.text }; } },
    "selectProject:unknown": { m: "project", run: async (W, m, R) => { const root = R.pick([os.homedir(), "/", "/etc", W.home, `${W.proj}/../..`, "", ...TEXT.map((x) => x[1]).slice(0, 8)]); const r = await W.msg({ type: "selectProject", root }); return { res: r, expect: "refused", check: () => r.json?.result?.flash === "BuildPilot doesn't know that folder" || (root === "" && r.json?.result?.flash) || `unknown folder accepted (${String(root).slice(0, 40)}): ${r.text.slice(0, 100)}` }; } },
    checkpoint: { m: "project", run: async (W) => { const r = await W.msg({ type: "checkpoint" }); return { res: r, expect: "refused", check: () => /Save point made \([0-9a-f]{8}\)/.test(r.json?.result?.flash) || r.text }; } },
    // ---------- sessions (from the page) ----------
    "renameBuild:fuzz": { m: "sessionUi", run: async (W, m, R) => { const [cls, t] = R.pick([...TEXT, ...WRONG]); m.lastFuzz = cls; const id = R.pick([m.sid, "short", "../../etc", "a".repeat(80), m.sid]); const r = await W.msg({ type: "renameBuild", id, name: t }); const valid = /^[A-Za-z0-9-]{8,64}$/.test(id); if (valid && id === m.sid) m.name = (typeof t === "string" ? t : typeof t === "number" || typeof t === "boolean" ? String(t) : "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40).toWellFormed() || null; return { res: r, expect: valid ? "ok" : "refused" }; } },
    dismissRisk: { m: "sessionUi", run: async (W, m, R) => { const r = await W.msg({ type: "dismissRisk", id: R.pick([m.sid, "nope-nope-nope"]) }); return { res: r, expect: "ok" }; } },
    hideIdle: { m: "sessionUi", run: async (W) => { const r = await W.msg({ type: "hideIdle" }); return { res: r, expect: "ok" }; } },
    "openBuild:known": { m: "sessionUi", run: async (W, m) => { const r = await W.msg({ type: "openBuild", cwd: W.proj, id: m.sid }); return { res: r, expect: "refused", check: () => !!(r.json?.result?.show || r.json?.result?.flash) || r.text }; } },
    "openBuild:unknown": { m: "sessionUi", run: async (W, m, R) => { const r = await W.msg({ type: "openBuild", cwd: R.pick(["/", "/etc", "", 7, W.home]), id: m.sid }); return { res: r, expect: "refused", check: () => r.json?.result?.flash === "BuildPilot doesn't know that folder" || r.text }; } },
    "resumeBuild:known": { m: "sessionUi", run: async (W, m) => { const n = W.osLog().length; const r = await W.msg({ type: "resumeBuild", id: m.sid, cwd: W.proj }); const o = W.osLog().slice(n); return { res: r, expect: "refused", check: () => (o.length === 1 && o[0].kind === "terminal" && o[0].command === `claude --resume ${m.sid}`) || `resume did ${JSON.stringify(o)}` }; } },
    "resumeBuild:injection": { m: "sessionUi", run: async (W, m, R) => { const n = W.osLog().length; const r = await W.msg({ type: "resumeBuild", id: R.pick([`${m.sid}; rm -rf ~`, "$(id)", m.sid]), cwd: R.pick(["/tmp", W.home, "/"]) }); const o = W.osLog().slice(n); return { res: r, expect: "refused", check: () => (o.length === 0 && r.json?.result?.flash === "Can't resume that one") || `resume with a bad id/folder did ${JSON.stringify(o)}` }; } },
    startFresh: { m: "sessionUi", run: async (W, m, R) => { const n = W.osLog().length; const cwd = R.pick([W.proj, "/etc", ""]); const r = await W.msg({ type: "startFresh", cwd }); const o = W.osLog().slice(n); const okDir = cwd === W.proj || cwd === ""; return { res: r, expect: "refused", check: () => (okDir ? o.some((x) => x.kind === "terminal" && x.dir === W.proj) && o.some((x) => x.kind === "copy") : o.length === 0) || `startFresh(${cwd}) did ${JSON.stringify(o).slice(0, 200)}` }; } },
    "whoChanged:fuzz": { m: "sessionUi", run: async (W, m, R) => { const [cls, t] = R.pick([...TEXT, ...WRONG]); m.lastFuzz = cls; const r = await W.msg({ type: "whoChanged", query: t }); return { res: r, expect: "refused", check: () => Array.isArray(r.json?.result?.files) || r.text }; } },
    "undoFile:unknown": { m: "sessionUi", run: async (W, m, R) => { const r = await W.msg({ type: "undoFile", path: R.pick(["/etc/hosts", path.join(W.proj, "package.json"), "", "../../x", path.join(W.home, ".claude/settings.json")]) }); return { res: r, expect: "refused", check: () => /only puts back files a Claude session changed/.test(r.json?.result?.flash) || r.text }; } },
    "undoFile:edited": { m: "sessionUi", pre: (m) => m.edited, run: async (W) => { const f = path.join(W.proj, "src/shared.txt"); fs.appendFileSync(f, "claude edit\n"); const r = await W.msg({ type: "undoFile", path: f }); return { res: r, expect: "ok", check: () => (/Put back the last saved version/.test(r.json?.result?.flash) && !fs.readFileSync(f, "utf8").includes("claude edit")) || r.text }; } },
    claudeEvent: { m: "sessionUi", run: async (W, m, R) => { const ev = R.pick(["UserPromptSubmit", "PermissionRequest", "Stop", "PostToolUse", "Notification", "StopFailure"]); const p = { session_id: m.sid, cwd: W.proj, hook_event_name: ev, nonce: m.n++, ...(ev === "UserPromptSubmit" ? { prompt: "add a checkout page" } : ev === "PostToolUse" ? { tool_name: "Edit", tool_input: { file_path: path.join(W.proj, "src/shared.txt") }, tool_response: {} } : ev === "Notification" ? { notification_type: "permission_prompt", message: "needs Bash" } : ev === "PermissionRequest" ? { tool_name: "Bash", tool_input: { command: "ls" } } : {}) }; if (ev === "PostToolUse") m.edited = true; const d = path.join(W.bph, "spool"); fs.mkdirSync(path.join(d, "tmp"), { recursive: true }); fs.writeFileSync(path.join(d, "tmp", `e${m.n}`), JSON.stringify(p)); fs.renameSync(path.join(d, "tmp", `e${m.n}`), path.join(d, `evt.model${m.n}.json`)); m.status = { UserPromptSubmit: "running", PermissionRequest: "awaiting_approval", Stop: "idle", PostToolUse: "running", Notification: "awaiting_approval", StopFailure: "failed" }[ev]; m.pendingEvent = true; return { res: null, expect: "env" }; } },
    // ---------- side builds ----------
    "newBuild": { m: "build", pre: (m) => known(m).length < 4, run: async (W, m, R) => {
      const [cls, label] = R.pick([...TEXT.filter(([c]) => !["huge-20k"].includes(c)), ["normal", "checkout"], ["normal", "dark mode"]]); m.lastFuzz = cls;
      const pre = await W.msg({ type: "newBuildCheck" });
      const allowed = isPro(m) || known(m).length < 1;
      if (!allowed) return { res: pre, expect: "refused", check: () => !!pre.json?.result?.paywall || `free plan at its limit wasn't told: ${pre.text}` };
      const n = W.osLog().length; const r = await W.msg({ type: "newBuild", label });
      const t = W.osLog().slice(n).find((x) => x.kind === "terminal");
      if (!t) return { res: r, expect: "ok", check: () => `no build started: ${r.text.slice(0, 160)}` };
      const branch = W.git(["rev-parse", "--abbrev-ref", "HEAD"], t.dir).trim();
      m.builds.set(t.dir, { dir: t.dir, branch, state: "clean", conflict: false, testsFail: !!m.mainTestsFail, files: 0 });
      return { res: r, expect: "ok", b: { dir: t.dir, was: "none" }, check: () => (pre.json?.result?.ok === true && /^New build /.test(r.json?.result?.flash) && /^bp\//.test(branch)) || `${pre.text} / ${r.text}` };
    } },
    "cli:new": { m: "build", pre: (m) => known(m).length < 4, run: async (W, m, R) => {
      const name = R.pick(["cli one", "it's mine", "x", "日本"]); const before = new Set(W.git(["worktree", "list", "--porcelain"]).match(/^worktree .+$/gm));
      const r = W.cli(["new", name]); const allowed = isPro(m) || known(m).length < 1;
      if (!allowed) return { res: { status: 200, cli: r }, expect: "refused", check: () => (r.code === 2 && /free plan runs 2 builds/.test(r.out)) || `CLI new at the free limit: ${r.code} ${r.out.slice(0, 120)}` };
      const dir = [...W.git(["worktree", "list", "--porcelain"]).match(/^worktree .+$/gm)].find((l) => !before.has(l))?.slice(9);
      if (dir) m.builds.set(dir, { dir, branch: W.git(["rev-parse", "--abbrev-ref", "HEAD"], dir).trim(), state: "clean", conflict: false, testsFail: !!m.mainTestsFail, files: 0 });
      return { res: { status: 200, cli: r }, expect: "ok", b: dir ? { dir, was: "none" } : null, check: () => (r.code === 0 && !!dir) || `bp new: ${r.code} ${r.out.slice(0, 160)}` };
    } },
    edit: { m: "build", pre: (m) => !!pickBuild(m, { pick: (x) => x[0] }, ["clean", "unsaved", "saved", "merged"]), run: async (W, m, R) => { const b = pickBuild(m, R, ["clean", "unsaved", "saved", "merged"]); fs.writeFileSync(path.join(b.dir, "src", `f${m.n++}.txt`), "work\n"); b.state = "unsaved"; return { res: null, expect: "env", b }; } },
    commitInBuild: { m: "build", pre: (m) => known(m).some((b) => b.state === "unsaved"), run: async (W, m, R) => { const b = pickBuild(m, R, ["unsaved"]); W.git(["add", "-A"], b.dir); W.git(["commit", "-qm", "work"], b.dir); b.state = "saved"; return { res: null, expect: "env", b }; } },
    makeConflict: { m: "build", pre: (m) => known(m).some((b) => ["clean", "unsaved", "saved", "merged"].includes(b.state)) && !m.mainDirty, run: async (W, m, R) => {
      const b = pickBuild(m, R, ["clean", "unsaved", "saved", "merged"]);
      fs.writeFileSync(path.join(b.dir, "src/shared.txt"), `build ${m.n++}\n`); W.git(["add", "-A"], b.dir); W.git(["commit", "-qm", "build side"], b.dir);
      fs.writeFileSync(path.join(W.proj, "src/shared.txt"), `main ${m.n++}\n`); W.git(["add", "-A"]); W.git(["commit", "-qm", "main side"]);
      b.state = "saved"; b.conflict = true; for (const o of known(m)) if (o !== b && o.state === "merged") o.state = "clean";
      return { res: null, expect: "env", b };
    } },
    fixConflict: { m: "build", pre: (m) => known(m).some((b) => b.conflict && b.state !== "unsaved"), run: async (W, m, R) => { const b = R.pick(known(m).filter((x) => x.conflict && x.state !== "unsaved")); W.git(["merge", "-q", "-X", "ours", "-m", "resolve", "main"], b.dir); b.conflict = false; b.state = "saved"; return { res: null, expect: "env", b }; } },
    breakTests: { m: "build", pre: (m) => known(m).some((b) => !b.testsFail && b.state !== "removed"), run: async (W, m, R) => { const b = R.pick(known(m).filter((x) => !x.testsFail)); fs.writeFileSync(path.join(b.dir, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "node -e \"process.exit(1)\"" } })); b.testsFail = true; b.state = "unsaved"; return { res: null, expect: "env", b }; } },
    mainDirty: { m: "project", pre: (m) => !m.mainDirty, run: async (W, m) => { fs.appendFileSync(path.join(W.proj, "package.json"), "\n"); m.mainDirty = true; return { res: null, expect: "env" }; } },
    mainClean: { m: "project", pre: (m) => m.mainDirty, run: async (W, m) => { W.git(["checkout", "--", "package.json"]); m.mainDirty = false; return { res: null, expect: "env" }; } },
    reviewBuild: { m: "build", run: async (W, m, R) => { const gone = [...m.builds.values()].filter((x) => x.state === "removed"); const b = (R.chance(0.85) ? pickBuild(m, R) : null) ?? (gone.length && R.chance(0.6) ? { ...R.pick(gone), state: "none", was: "removed" } : { dir: R.pick(["/etc", W.proj, ""]), branch: "main", state: "none" }); const r = await W.msg({ type: "reviewBuild", dir: b.dir, branch: b.branch }); return { res: r, expect: "refused", b, check: () => (b.state === "none" ? /isn't one of this project's side builds/.test(r.json?.result?.flash) : !!r.json?.result?.show) || r.text.slice(0, 160) }; } },
    mergeBuild: { m: "build", run: async (W, m, R) => mergeAction(W, m, R, false) },
    "mergeBuild:force": { m: "build", run: async (W, m, R) => mergeAction(W, m, R, true) },
    "cli:merge": { m: "build", pre: (m) => known(m).length > 0, run: async (W, m, R) => mergeAction(W, m, R, false, true) },
    removeBuild: { m: "build", run: async (W, m, R) => removeAction(W, m, R, false) },
    "cli:done": { m: "build", pre: (m) => known(m).length > 0, run: async (W, m, R) => removeAction(W, m, R, true) },
    "cli:review": { m: "build", pre: (m) => known(m).length > 0, run: async (W, m, R) => { const b = pickBuild(m, R); const r = W.cli(["review", path.basename(b.dir)]); return { res: { status: 200, cli: r }, expect: "refused", b, check: () => r.code === 0 || `bp review: ${r.code} ${r.out.slice(0, 120)}` }; } },
    "cli:builds": { m: "project", run: async (W, m) => { const r = W.cli(["builds"]); return { res: { status: 200, cli: r }, expect: "refused", check: () => (r.code === 0 && known(m).every((b) => r.out.includes(path.basename(b.dir)))) || `bp builds misses one: ${r.out.slice(0, 160)}` }; } },
    // ---------- robustness ----------
    "raw:body": { m: "env", run: async (W, m, R) => { const [cls, body] = R.pick(BODIES); m.lastFuzz = cls; const r = await W.req("/api/msg", { method: "POST", body }); return { res: r, expect: "refused", raw: cls } ; } },
    "raw:wrongTypes": { m: "env", run: async (W, m, R) => { const type = R.pick(["reviewBuild", "mergeBuild", "removeBuild", "renameBuild", "selectProject", "startFresh", "openBuild", "copy", "sendToClaude", "whoChanged", "undoFile", "resumeBuild", "enterLicense"]); const [cls, v] = R.pick(WRONG); m.lastFuzz = cls; const r = await W.msg({ type, id: v, cwd: v, dir: v, branch: v, root: v, path: v, query: v, key: v, name: v, text: v, label: v }); return { res: r, expect: ["copy", "sendToClaude"].includes(type) ? "env" : "refused" }; } },
    "raw:auth": { m: "env", run: async (W, m, R) => { const h = R.pick([{ "x-bp-token": "wrong" }, { "x-bp-token": "" }, { host: "evil.example" }, { origin: "http://evil.example" }, { origin: "null" }]); const r = await rawPost(W, "/api/msg", JSON.stringify({ type: "disconnect" }), { "x-bp-token": W.info.token, "content-type": "application/json", host: `127.0.0.1:${W.info.port}`, ...h }); return { res: r, expect: "refused", check: () => [401, 403].includes(r.status) || `unauthenticated request got ${r.status}` }; } },
    "raw:unknownType": { m: "env", run: async (W, m, R) => { const r = await W.msg({ type: R.pick(["", "constructor", "__proto__", "toString", "eval", "nope"]) }); return { res: r, expect: "refused", check: () => r.json?.result === null || r.text }; } },
    restartServer: { m: "env", run: async (W) => { const before = await W.state(); await W.stop(); await W.start(); const after = await W.state(); const pick = (s) => JSON.stringify({ side: (s.page.side ?? []).map((x) => x.dir).sort(), plan: { ...s.page.plan, trialEndsAt: null }, theme: s.settings.theme, alerts: s.settings.alerts, names: s.page.builds.map((b) => [b.id, b.name]).sort() }); return { res: null, expect: "env", check: () => pick(before) === pick(after) || `state changed across a restart:\n ${pick(before)}\n ${pick(after)}` }; } },
    "repeat:last": { m: "env", run: null }, // filled by the walker: the previous action again, at once
  };
  return A;
}

async function mergeAction(W, m, R, force, viaCli = false) {
  const live = [...m.builds.values()].filter((b) => b.state !== "removed");
  const gone = [...m.builds.values()].filter((b) => b.state === "removed");
  const b = live.length && R.chance(0.85) ? R.pick(live) : gone.length && R.chance(0.6) ? { ...R.pick(gone), state: "none", was: "removed" } : { dir: R.pick(["/etc", W.proj, path.join(W.home, "nope")]), branch: "main", state: "none" };
  const pro = isPro(m);
  let res, out;
  if (viaCli) { const r = W.cli(["merge", path.basename(b.dir)]); res = { status: 200, cli: r }; out = r.out; }
  else { const r = await W.msg({ type: "mergeBuild", dir: b.dir, branch: b.branch, force }); res = r; out = JSON.stringify(r.json?.result ?? r.text); }
  // What should have happened:
  if (b.state === "none") return { res, expect: "refused", b, check: () => /isn't one of this project's side builds|No side build called/.test(out) || out.slice(0, 160) };
  if (b.state === "clean" || b.state === "merged") return { res, expect: "refused", b, check: () => /Nothing to merge yet/i.test(out) || out.slice(0, 160) };
  const runsTests = pro;
  if (runsTests && b.testsFail && !force) return { res, expect: "refused", b, check: () => /tests FAIL/i.test(out) || out.slice(0, 160) };
  // From here the build's unsaved work is saved first.
  const wasUnsaved = b.state === "unsaved";
  if (m.mainDirty) { b.state = "saved"; return { res, expect: wasUnsaved ? "ok" : "refused", b, keepMain: true, check: () => /main project has unsaved changes/.test(out) || out.slice(0, 160) }; }
  if (b.conflict) { b.state = "saved"; return { res, expect: wasUnsaved ? "ok" : "refused", b, keepMain: true, check: () => /Both builds changed the same lines/.test(out) && !fs.existsSync(path.join(W.proj, ".git/MERGE_HEAD")) || out.slice(0, 160) }; }
  b.state = "merged"; for (const o of m.builds.values()) if (o !== b && o.state === "merged") o.state = "clean"; // main moved on: their diff vs. main is "nothing yet" again only if fully merged
  if (b.testsFail) { /* package.json in main now fails too */ m.mainTestsFail = true; }
  return { res, expect: "ok", b, check: () => /Merged bp\//.test(out) || out.slice(0, 200) };
}

async function removeAction(W, m, R, viaCli) {
  const live = [...m.builds.values()].filter((b) => b.state !== "removed");
  const gone = [...m.builds.values()].filter((b) => b.state === "removed");
  const b = live.length && R.chance(0.85) ? R.pick(live) : gone.length && R.chance(0.6) ? { ...R.pick(gone), state: "none", was: "removed" } : { dir: R.pick(["/etc", W.proj, W.home]), branch: "x", state: "none" };
  let out, res;
  if (viaCli) { const r = W.cli(["done", path.basename(b.dir)]); res = { status: 200, cli: r }; out = r.out; }
  else { const r = await W.msg({ type: "removeBuild", dir: b.dir, branch: b.branch }); res = r; out = JSON.stringify(r.json?.result ?? r.text); }
  if (b.state === "none") return { res, expect: "refused", b, check: () => /isn't one of this project's side builds|No build called/.test(out) || out.slice(0, 160) };
  if (b.state === "unsaved") return { res, expect: "refused", b, check: () => /unsaved changes/.test(out) || out.slice(0, 160) };
  b.state = "removed";
  return { res, expect: "ok", b, check: () => (/Removed/.test(out) && !fs.existsSync(b.dir) && W.git(["branch", "--list", b.branch]).trim().length > 0) || `remove: ${out.slice(0, 160)}` };
}

/** Invariants that must hold after every step, whatever the action was. */
export async function checkServer(W, m) {
  const errs = [];
  const s = await W.req("/api/state");
  if (s.status !== 200) return [`/api/state answered ${s.status} ${s.text.slice(0, 200)}`];
  const st = s.json; const P = st.page;
  // plan
  const pro = isPro(m);
  if (P.plan.pro !== pro) errs.push(`plan.pro ${P.plan.pro}, expected ${pro} (licensed ${m.licensed}, trial ${m.trialLeft}, sellable ${m.sellable})`);
  if (P.plan.licensed !== m.licensed) errs.push(`plan.licensed ${P.plan.licensed}, expected ${m.licensed}`);
  if (P.plan.freeLeft !== (pro ? null : Math.max(0, 20 - m.count))) errs.push(`freeLeft ${P.plan.freeLeft}, expected ${pro ? null : Math.max(0, 20 - m.count)}`);
  let usage = null; try { usage = JSON.parse(fs.readFileSync(path.join(W.bph, "usage.json"), "utf8")).count; } catch {}
  if ((usage ?? 0) !== m.count) errs.push(`usage.json count ${usage}, expected ${m.count}`);
  // prefs
  const theme = m.theme === "match" || m.theme === "auto" ? m.theme : "white";
  if (st.settings.theme !== theme) errs.push(`theme ${st.settings.theme}, expected ${theme}`);
  if (st.settings.alerts !== m.alerts) errs.push(`alerts ${st.settings.alerts}, expected ${m.alerts}`);
  // connection
  if (P.connected !== (m.connected || m.plugin)) errs.push(`connected ${P.connected}, expected ${m.connected || m.plugin}`);
  try { JSON.parse(fs.readFileSync(W.settingsFile, "utf8")); } catch (e) { errs.push(`settings.json is no longer valid JSON: ${e.message}`); }
  // side builds: page = git = model (the page re-reads every 5 s, so give it one refresh)
  const want = [...m.builds.values()].filter((b) => b.state !== "removed").map((b) => b.dir).sort();
  const gitList = (W.git(["worktree", "list", "--porcelain"]).match(/^worktree .+$/gm) ?? []).map((l) => l.slice(9)).filter((d) => d !== W.proj).sort();
  if (JSON.stringify(gitList) !== JSON.stringify(want)) errs.push(`git worktrees ${JSON.stringify(gitList)} ≠ model ${JSON.stringify(want)}`);
  let side = (P.side ?? []).map((x) => x.dir).sort();
  // Changes made outside the window (bp new / bp done) show at the next background re-read (every 5 s, a few git calls).
  for (let i = 0; i < 30 && JSON.stringify(side) !== JSON.stringify(want); i++) { await sleep(500); side = ((await W.state()).page.side ?? []).map((x) => x.dir).sort(); }
  if (JSON.stringify(side) !== JSON.stringify(want)) { if (JSON.stringify(side) !== JSON.stringify(want)) errs.push(`page side builds ${JSON.stringify(side.map((d) => path.basename(d)))} ≠ ${JSON.stringify(want.map((d) => path.basename(d)))}`); }
  // The page re-reads side builds in the background every 5 s: a change made outside the window must show by then.
  const sideErrs = (list) => { const out = []; for (const x of list ?? []) { const b = m.builds.get(x.dir); if (!b) continue; if ((b.state === "clean" || b.state === "merged") && x.changed !== 0) out.push(`${x.name}: ${x.changed} files changed, expected none (${b.state})`); if ((b.state === "unsaved" || b.state === "saved") && x.changed === 0) out.push(`${x.name}: no changes shown, but it has ${b.state} work`); } return out; };
  let se1 = sideErrs(P.side);
  for (let i = 0; i < 30 && se1.length; i++) { await sleep(500); se1 = sideErrs((await W.state()).page.side); }
  errs.push(...se1);
  if (fs.existsSync(path.join(W.proj, ".git/MERGE_HEAD"))) errs.push("main project left in the middle of a merge");
  for (const b of m.builds.values()) if (W.git(["branch", "--list", b.branch]).trim() === "") errs.push(`branch ${b.branch} was deleted`);
  // counts on the page agree with each other
  if (P.needs !== P.builds.filter((b) => b.needsYou).length) errs.push(`needs ${P.needs} ≠ ${P.builds.filter((b) => b.needsYou).length} rows that need you`);
  const ids = P.builds.map((b) => b.id); if (new Set(ids).size !== ids.length) errs.push("a session is listed twice");
  const mine = P.builds.find((b) => b.id === m.sid);
  if (mine && (mine.name ?? null) !== m.name) errs.push(`session name "${mine.name}", expected "${m.name}"`);
  if (BAD_TEXT.test(JSON.stringify(P))) errs.push(`page data contains ${JSON.stringify(P).match(BAD_TEXT)[0]}`);
  // OS side effects: only the logged kinds, only in folders BuildPilot knows.
  const okDirs = new Set([W.proj, ...[...m.builds.keys()]]);
  for (const o of W.osLog()) {
    if (!["terminal", "copy", "open", "focus", "notify"].includes(o.kind)) errs.push(`unexpected OS effect ${o.kind}`);
    if (o.kind === "terminal" && !okDirs.has(o.dir)) errs.push(`terminal opened in an unknown folder ${o.dir}`);
    if (o.kind === "open" && !/^https:\/\/buy\.stripe\.com\//.test(o.url)) errs.push(`opened ${o.url}`);
  }
  const se = W.server?.errText?.() ?? ""; if (/Error|at .+:\d+:\d+/.test(se.replace(/ExperimentalWarning.*\n?/g, ""))) errs.push(`server printed an error: ${se.slice(0, 200)}`);
  return errs;
}

export const buildLabel = (b, m) => b.state === "removed" ? "removed" : `${b.state}${b.conflict ? "+conflict" : ""}${b.testsFail && isPro(m) && (b.state === "unsaved" || b.state === "saved") ? "+failing" : ""}`;

export async function runApiWalk({ B, R, steps = 120, seq = null, cfg, record, covered = null }) {
  const W = await makeServerWorld(B, cfg);
  const m = { sellable: cfg.sellable !== false, trialLeft: cfg.trialDays ?? 0, licensed: !!cfg.licenseValid, count: cfg.count ?? 0, theme: "white", alerts: true, connected: false, plugin: !!cfg.plugin, builds: new Map(), mainDirty: false, sid: "abcd1234-0000-4000-8000-00000000beef", name: null, n: 0, edited: false };
  const A = apiActions(B);
  const log = []; const failures = []; let prev = null; const lastBy = new Map();
  const total = seq ? seq.length : steps;
  // A session exists from the start (so session actions have something to act on).
  await A.claudeEvent.run(W, m, rng(7)); await sleep(400);
  try {
    for (let step = 0; step < total; step++) {
      let name = seq ? seq[step].a : null; const sub = seq ? seq[step].s : R.int(0, 2 ** 31); const SR = rng(sub);
      if (!name) {
        const enabled = Object.entries(A).filter(([, a]) => a.run && (!a.pre || a.pre(m)));
        // Sometimes the same action again at once (impatient double press / retry), if it is still possible.
        name = prev && R.chance(0.07) && enabled.some(([k]) => k === prev) ? prev : null;
        // Coverage-guided: usually prefer an action whose (state, action) or (last action of its entity, action) pair
        // hasn't been run yet in this whole run; otherwise any enabled action.
        if (!name && covered && R.chance(0.75)) {
          const sm = summarize(m);
          const fresh = enabled.filter(([k, x]) => (x.m !== "build" && !covered.t.has(`${x.m}|${sm[x.m]}|${k}`)) || (lastBy.get(x.m) && !covered.p.has(`${x.m}|${lastBy.get(x.m)}>${k}`)));
          if (fresh.length) name = R.pick(fresh)[0];
        }
        if (!name) name = R.pick(enabled)[0];
      }
      const a = A[name];
      if (!a?.run || (a.pre && !a.pre(m))) { if (seq) continue; throw new Error(`disabled ${name}`); }
      const fpBefore = fingerprint(W);
      const stateBefore = summarize(m);
      const buildBefore = new Map([...m.builds].map(([k, v]) => [k, buildLabel(v, m)]));
      let r;
      try { r = await withTimeout(a.run(W, m, SR), 150_000, name); } catch (e) { failures.push({ step, action: name, errors: [`action threw: ${e.message.slice(0, 300)}`] }); log.push({ a: name, s: sub }); break; }
      if (m.pendingEvent) { await sleep(450); m.pendingEvent = false; }
      log.push({ a: name, s: sub });
      if (a.m === "build") { const tb = r.b; const from = tb ? (tb.was ?? buildBefore.get(tb.dir) ?? "none") : "none"; record?.transition("build", from, name, tb && m.builds.has(tb.dir) ? buildLabel(m.builds.get(tb.dir), m) : from); }
      else record?.transition(a.m, stateBefore[a.m] ?? "-", name, summarize(m)[a.m] ?? "-");
      // 2-switch: consecutive actions on the same entity (machine), and consecutive actions overall.
      const lastOf = lastBy.get(a.m); if (lastOf) record?.pair(a.m, lastOf, name); lastBy.set(a.m, name);
      if (prev) record?.pair("any", prev, name);
      if (m.lastFuzz) { record?.hit("fuzz", `${name}:${m.lastFuzz}`); m.lastFuzz = null; }
      prev = name;
      const errs = [];
      if (r.res && (r.res.status >= 500 || r.res.status === -1)) errs.push(`${name} → HTTP ${r.res.status} ${r.res.text?.slice(0, 160)}`);
      if (r.res && r.res.cli && (r.res.cli.code === -1 || /\n\s+at .+:\d+/.test(r.res.cli.out) || BAD_TEXT.test(r.res.cli.out))) errs.push(`${name}: CLI ${r.res.cli.code} ${r.res.cli.out.slice(0, 200)}`);
      if (r.res?.text && BAD_TEXT.test(r.res.text) && !name.startsWith("raw:")) errs.push(`${name} answer shows ${r.res.text.match(BAD_TEXT)[0]}: ${r.res.text.slice(0, 120)}`);
      if (r.check) { const c = r.check(); if (c !== true) errs.push(`${name}: ${c}`); }
      if (r.expect === "refused") {
        const fpAfter = fingerprint(W);
        if (fpAfter !== fpBefore) errs.push(`${name} should change nothing, but changed: ${diffFp(fpBefore, fpAfter)}`);
      }
      r.after?.();
      errs.push(...(await checkServer(W, m, step)));
      if (errs.length) { failures.push({ step, action: name, errors: errs }); break; }
    }
  } finally { await W.cleanup(); }
  return { steps: log.length, log, failures };
}

function summarize(m) {
  const pro = isPro(m);
  const plan = m.licensed ? "licensed" : !m.sellable ? "not-sellable" : m.trialLeft > 3 ? "trial" : m.trialLeft > 0 ? "trial-ending" : m.count >= 20 ? "free-exhausted" : "free";
  const builds = [...m.builds.values()].filter((b) => b.state !== "removed");
  const b = builds.length ? builds.map((x) => x.state + (x.conflict ? "+conflict" : "") + (x.testsFail && pro ? "+failing" : "")).sort().join(",") : "none";
  return { plan, prefs: `${m.theme}/${m.alerts ? "on" : "off"}`, connection: m.plugin ? (m.connected ? "plugin+hooks" : "plugin") : m.connected ? "connected" : "disconnected", project: m.mainDirty ? "dirty" : "clean", sessionUi: m.status ?? "absent", build: `${builds.length}:${b}${m.mainDirty ? ":main-dirty" : ""}`, env: plan, mixed: "-" };
}

function diffFp(a, b) { const x = JSON.parse(a), y = JSON.parse(b); return Object.keys(x).filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k])).map((k) => `${k}: ${JSON.stringify(x[k]).slice(0, 80)} → ${JSON.stringify(y[k]).slice(0, 80)}`).join("; "); }

/** The Integration API (`bp serve`): every endpoint × method × auth × body class. */
export async function runIntegrationApi({ B, record }) {
  const W = await makeServerWorld(B, { sellable: true, trialDays: 0, count: 19 });
  const p = spawn("node", [B.cli, "serve", W.proj], { cwd: W.proj, env: { ...W.env, BUILDPILOT_PORT: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; p.stdout.on("data", (d) => (out += d));
  for (let i = 0; i < 100 && !/127\.0\.0\.1:\d+/.test(out); i++) await sleep(100);
  const port = Number(/127\.0\.0\.1:(\d+)/.exec(out)?.[1]);
  const token = fs.readFileSync(path.join(W.bph, "api-token"), "utf8").trim();
  const failures = []; let n = 0; let used = 19;
  const call = async (method, pth, { auth = `Bearer ${token}`, body } = {}) => { try { const r = await fetch(`http://127.0.0.1:${port}${pth}`, { method, headers: auth ? { authorization: auth } : {}, body }); return { status: r.status, text: await r.text(), ctype: r.headers.get("content-type") ?? "", cors: r.headers.get("access-control-allow-origin") }; } catch (e) { return { status: -1, text: e.message }; } };
  const expect = async (name, method, pth, opts, want) => { const r = await call(method, pth, opts); n++; record?.hit("integration", name); const ok = typeof want === "function" ? want(r) : r.status === want; if (ok !== true) failures.push({ name, status: r.status, text: r.text.slice(0, 160), why: typeof ok === "string" ? ok : `expected ${want}` }); if (r.cors) failures.push({ name, why: "sends a CORS header" }); if (r.status >= 500 || r.status === -1) failures.push({ name, status: r.status, why: "5xx / unreachable" }); };
  for (const ep of ["/v1/brief", "/v1/brief?format=text", "/v1/status", "/v1/sessions", "/v1/next", "/v1/goals", "/v1/health", "/v1/nope", "/", "/pocket"]) {
    for (const [an, auth] of [["ok", `Bearer ${token}`], ["none", null], ["wrong", "Bearer x"], ["basic", `Basic ${token}`], ["lower", `bearer ${token}`], ["padded", `Bearer  ${token} `]]) {
      const pocket = ep === "/pocket";
      const want = pocket ? 200 : ["none", "wrong", "basic"].includes(an) ? 401 : ep === "/v1/nope" || ep === "/" ? 404 : 200;
      await expect(`GET ${ep} auth=${an}`, "GET", ep, { auth }, (r) => r.status === want || `got ${r.status}, want ${want}`);
    }
    for (const m of ["PUT", "DELETE", "PATCH"]) await expect(`${m} ${ep}`, m, ep, {}, (r) => (ep === "/pocket" ? [401, 405].includes(r.status) : r.status === 405) || `got ${r.status}`);
  }
  await expect("GET /v1/sessions shape", "GET", "/v1/sessions", {}, (r) => { try { const j = JSON.parse(r.text); return (Array.isArray(j) && j.every((s) => typeof s.id === "string" && "status" in s)) || "not a list of sessions"; } catch { return "not JSON"; } });
  for (const [cls, body] of [...BODIES.filter(([c]) => c !== "too-big-400k"), ...TEXT.map(([c, t]) => [`request:${c}`, JSON.stringify({ goal: "feature", request: t })]), ["goal-bogus", JSON.stringify({ goal: "nope", request: "add a form" })], ["request-number", JSON.stringify({ request: 5 })], ["over-20k", JSON.stringify({ request: "a".repeat(25_000) })]]) {
    const r = await call("POST", "/v1/prompt", { body });
    n++; record?.hit("integration", `POST /v1/prompt ${cls}`);
    let j = null; try { j = JSON.parse(r.text); } catch {}
    const validReq = j !== null && /^request:/.test(cls) ? (() => { const t = JSON.parse(body).request; return typeof t === "string" && t.trim().length > 0; })() : cls === "goal-bogus";
    if (r.status >= 500 || r.status === -1) failures.push({ name: `POST /v1/prompt ${cls}`, status: r.status, text: r.text.slice(0, 120) });
    else if (validReq && body.length <= 20_000) { if (used < 20 ? r.status !== 200 : r.status !== 402) failures.push({ name: `POST /v1/prompt ${cls}`, status: r.status, why: `prompt ${used} of 20 → ${r.status}` }); if (r.status === 200) used++; }
    else if (body.length > 20_000) { if (r.status !== 413) failures.push({ name: `POST /v1/prompt ${cls}`, status: r.status, why: "over 20,000 characters not answered 413" }); }
    else if (![400, 402].includes(r.status)) failures.push({ name: `POST /v1/prompt ${cls}`, status: r.status, why: "bad input not refused with 400" });
    if (BAD.test(r.text)) failures.push({ name: `POST /v1/prompt ${cls}`, why: `answer contains ${r.text.match(BAD)[0]}` });
  }
  await expect("GET /v1/health after the fuzz", "GET", "/v1/health", {}, 200);
  p.kill("SIGTERM"); await sleep(200); await W.cleanup();
  return { cases: n, failures };
}
const BAD = /\bundefined\b|\bNaN\b|\[object Object\]/;

/** The side-build lifecycle as the model says it goes (Pro, so failing tests block a merge). Self-loops = refusals. */
export const BUILD_EDGES = {
  none: [["newBuild", "clean"], ["mergeBuild", "none"], ["removeBuild", "none"]],
  clean: [["edit", "unsaved"], ["breakTests", "unsaved+failing"], ["makeConflict", "saved+conflict"], ["mergeBuild", "clean"], ["removeBuild", "removed"], ["cli:done", "removed"]],
  unsaved: [["commitInBuild", "saved"], ["mergeBuild", "merged"], ["cli:merge", "merged"], ["removeBuild", "unsaved"], ["breakTests", "unsaved+failing"]],
  saved: [["mergeBuild", "merged"], ["edit", "unsaved"], ["makeConflict", "saved+conflict"], ["removeBuild", "removed"]],
  "saved+conflict": [["mergeBuild", "saved+conflict"], ["cli:merge", "saved+conflict"], ["fixConflict", "saved"], ["edit", "unsaved+conflict"], ["removeBuild", "removed"]],
  "unsaved+conflict": [["commitInBuild", "saved+conflict"], ["mergeBuild", "saved+conflict"], ["removeBuild", "unsaved+conflict"]],
  "unsaved+failing": [["mergeBuild", "unsaved+failing"], ["mergeBuild:force", "merged"], ["commitInBuild", "saved+failing"], ["removeBuild", "unsaved+failing"]],
  "saved+failing": [["mergeBuild", "saved+failing"], ["cli:merge", "saved+failing"], ["mergeBuild:force", "merged"], ["removeBuild", "removed"]],
  merged: [["mergeBuild", "merged"], ["edit", "unsaved"], ["removeBuild", "removed"], ["cli:done", "removed"]],
  removed: [["mergeBuild", "removed"], ["removeBuild", "removed"], ["reviewBuild", "removed"]],
};

/**
 * Every simple STATE path none → removed (no state twice; reversals such as merged → unsaved included). Where several
 * actions lead along the same edge (merge in the window or with bp merge, remove or bp done), they take turns, so every
 * edge action is used. Refusals (self-loops) are covered by the all-transitions criterion, not repeated here.
 */
export function buildPaths() {
  const out = []; const turn = new Map();
  const walk = (s, seen, acts) => {
    if (s === "removed") { out.push([...acts, { a: "mergeBuild", to: "removed" }]); return; }
    const byTo = new Map(); for (const [a, to] of BUILD_EDGES[s]) if (to !== s) byTo.set(to, [...(byTo.get(to) ?? []), a]);
    for (const [to, as] of byTo) {
      if (seen.has(to)) continue;
      const k = `${s}>${to}`; const i = turn.get(k) ?? 0; turn.set(k, i + 1);
      seen.add(to); acts.push({ a: as[i % as.length], to }); walk(to, seen, acts); acts.pop(); seen.delete(to);
    }
  };
  walk("none", new Set(["none"]), []);
  return out;
}

export async function runBuildPaths({ B, paths, record }) {
  const W = await makeServerWorld(B, { sellable: true, trialDays: 0, license: B.mint() });
  const m = { sellable: true, trialLeft: 0, licensed: true, count: 0, theme: "white", alerts: true, connected: false, plugin: false, builds: new Map(), mainDirty: false, sid: "abcd1234-0000-4000-8000-00000000beef", name: null, n: 0, edited: false };
  const A = apiActions(B);
  // Deterministic choices: always the live build, never a decoy folder (decoys are covered by the random walks).
  const R0 = { chance: (p) => p >= 0.5, pick: (xs) => xs[xs.length - 1], int: (a) => a, weighted: (p) => p[0][0], next: () => 0 };
  const failures = []; let realized = 0;
  try {
    for (const p of paths) {
      let ok = true;
      for (const [i, { a: name, to }] of p.entries()) {
        const before = fingerprint(W);
        const target = [...m.builds.values()].find((b) => b.state !== "removed");
        let r;
        if (to === "removed" && name !== "removeBuild" && name !== "cli:done" && !target) {
          // after removal: act on the removed folder directly
          const gone = [...m.builds.values()].filter((b) => b.state === "removed").pop();
          const res = await W.msg({ type: name === "reviewBuild" ? "reviewBuild" : name, dir: gone.dir, branch: gone.branch });
          r = { res, expect: "refused", check: () => /isn't one of this project's side builds/.test(res.text) || res.text.slice(0, 120) };
        } else r = await withTimeout(A[name].run(W, m, R0), 150_000, name);
        if (m.pendingEvent) { await sleep(400); m.pendingEvent = false; }
        const errs = [];
        if (r.res && (r.res.status >= 500 || r.res.status === -1)) errs.push(`HTTP ${r.res.status}`);
        if (r.check) { const c = r.check(); if (c !== true) errs.push(c); }
        if (r.expect === "refused" && fingerprint(W) !== before) errs.push(`${name} should change nothing: ${diffFp(before, fingerprint(W))}`);
        const t2 = [...m.builds.values()].find((b) => b.dir === (target ?? r.b)?.dir) ?? [...m.builds.values()].pop();
        const now = t2 ? buildLabel(t2, m) : "none";
        record?.transition("build-path", i ? p[i - 1].to : "none", name, now);
        // A build merged with --force still has its failing tests, so its later edits are "+failing" too.
        const forced = p.slice(0, i).some((x) => x.a === "mergeBuild:force");
        if (now !== to && !(forced && now === `${to}+failing`)) { errs.push(`after ${name} the build is ${now}, the model says ${to}`); }
        errs.push(...(await checkServer(W, m, i)));
        if (errs.length) { failures.push({ path: p.map((x) => x.a), step: i, errors: errs }); ok = false; break; }
      }
      if (ok) realized++;
      else break; // the world is now out of step with the model; stop here and report
      // removed builds stay in the model: their folders are known, and acting on them must be refused
      if (m.mainTestsFail) { fs.writeFileSync(path.join(W.proj, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "node -e 0" } })); W.git(["commit", "-qam", "tests pass again"]); m.mainTestsFail = false; }
    }
  } finally { await W.cleanup(); }
  return { paths: paths.length, realized, failures };
}

/**
 * Criterion (a) for side builds, exhaustively: for every build state, reach it by the shortest lifecycle path, then try
 * EVERY action possible from it (including the ones that must be refused), on a Pro world (tests run before merge).
 */
export async function runBuildTransitions({ B, record, only = null }) {
  const { buildFeasible, BUILD_STATES } = await import("./model.mjs");
  const W = await makeServerWorld(B, { sellable: true, trialDays: 0, license: B.mint() });
  const m = { sellable: true, trialLeft: 0, licensed: true, count: 0, theme: "white", alerts: true, connected: false, plugin: false, builds: new Map(), mainDirty: false, sid: "abcd1234-0000-4000-8000-00000000beef", name: null, n: 0, edited: false };
  const A = apiActions(B);
  const R0 = { chance: (p) => p >= 0.5, pick: (xs) => xs[xs.length - 1], int: (a) => a, weighted: (p) => p[0][0], next: () => 0 };
  const prefixTo = (target) => { const q = [["none", []]]; const seen = new Set(["none"]); while (q.length) { const [st, acts] = q.shift(); if (st === target) return acts; for (const [a, to] of BUILD_EDGES[st] ?? []) if (!seen.has(to)) { seen.add(to); q.push([to, [...acts, a]]); } } return null; };
  const actions = Object.keys(A).filter((k) => A[k].m === "build");
  const failures = []; let ran = 0;
  const tidy = () => { for (const b of m.builds.values()) if (b.state !== "removed") { try { W.git(["worktree", "remove", "--force", b.dir]); } catch {} b.state = "removed"; } if (m.mainTestsFail) { fs.writeFileSync(path.join(W.proj, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "node -e 0" } })); W.git(["commit", "-qam", "tests pass again"]); m.mainTestsFail = false; } };
  try {
    for (const st of only ?? BUILD_STATES) {
      const prefix = prefixTo(st) ?? [];
      for (const a of actions.filter((x) => buildFeasible(st, x))) {
        tidy();
        let ok = true;
        for (const p of prefix) { const r = await withTimeout(A[p].run(W, m, R0), 150_000, p); if (r.check && r.check() !== true) { ok = false; failures.push({ state: st, action: a, errors: [`reaching ${st}: ${p}: ${r.check()}`] }); break; } }
        if (!ok) continue;
        const live = [...m.builds.values()].filter((b) => b.state !== "removed").pop();
        const now = live ? buildLabel(live, m) : st === "removed" ? "removed" : "none";
        if (now !== st) { failures.push({ state: st, action: a, errors: [`prefix ${prefix.join(" → ")} reached ${now}, not ${st}`] }); continue; }
        const before = fingerprint(W);
        if (A[a].pre && !A[a].pre(m)) continue;
        let r; try { r = await withTimeout(A[a].run(W, m, R0), 150_000, a); } catch (e) { failures.push({ state: st, action: a, errors: [e.message] }); continue; } ran++;
        const errs = [];
        if (r.res && (r.res.status >= 500 || r.res.status === -1)) errs.push(`HTTP ${r.res.status}`);
        if (r.check) { const c = r.check(); if (c !== true) errs.push(c); }
        if (r.expect === "refused" && fingerprint(W) !== before) errs.push(`should change nothing: ${diffFp(before, fingerprint(W))}`);
        errs.push(...(await withTimeout(checkServer(W, m), 120_000, "checks").catch((e) => [e.message])));
        const after = r.b?.dir && m.builds.has(r.b.dir) ? buildLabel(m.builds.get(r.b.dir), m) : live && m.builds.has(live.dir) ? buildLabel(m.builds.get(live.dir), m) : st;
        record?.transition("build", st, a, after);
        if (errs.length) failures.push({ state: st, action: a, errors: errs });
      }
    }
  } finally { await W.cleanup(); }
  return { ran, failures };
}
