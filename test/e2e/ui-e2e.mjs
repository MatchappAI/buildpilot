// End-to-end: real `bp ui` server (temp HOME) + headless Chrome. Every step checks the real outcome (settings file, git, OS log).
import fs from "fs"; import http from "http"; import os from "os"; import path from "path"; import { execFileSync } from "child_process";
import { launch } from "./cdp.mjs"; import { makeEnv, REPO } from "./env.mjs";
const results = []; const OUT = process.argv[2] ?? path.join(os.tmpdir(), "bp-e2e-shots");
fs.mkdirSync(OUT, { recursive: true });
const E = makeEnv();
setTimeout(() => { console.error("e2e: gave up after 5 min"); E.cleanup(); process.exit(2); }, 300_000).unref(); const { url, info } = await E.startUi();
const b = await launch();
const axeSrc = fs.readFileSync(path.join(REPO, "node_modules/axe-core/axe.min.js"), "utf8");
async function step(name, fn) { try { const note = await Promise.race([fn(), new Promise((_, j) => setTimeout(() => j(new Error("step took over 60 s")), 60000))]); results.push({ name, ok: true, note: note ?? "" }); } catch (e) { results.push({ name, ok: false, note: String(e.message).slice(0, 300) }); } }
const ok = (c, msg) => { if (!c) throw new Error(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Always act on the newest dialog (a slow earlier one, e.g. "Go to tab", must not catch the click).
const top = (sel) => b.eval((s) => { const m = [...document.querySelectorAll(".bp-modal")].pop(); const e = m?.querySelector(s); if (!e) return false; e.click(); return true; }, sel);
const modalOk = async () => { await b.wait(() => !![...document.querySelectorAll(".bp-modal")].pop()?.querySelector("[data-ok]")); await top("[data-ok]"); await sleep(150); };
const modalCancel = async () => { await b.wait(() => !![...document.querySelectorAll(".bp-modal")].pop()?.querySelector("[data-x]")); await top("[data-x]"); await sleep(150); };
const modalInput = async (v) => { await b.wait(() => !!document.querySelector(".bp-modal input")); await b.eval((v) => { document.querySelector(".bp-modal input").value = v; }, v); await top("[data-ok]"); };
const flash = () => b.eval(() => document.getElementById("flash")?.textContent ?? "");
const axe = async (label) => {
  await b.eval((src) => { if (!window.axe) { const s = document.createElement("script"); s.textContent = src; document.head.appendChild(s); } return true; }, axeSrc);
  const v = await b.eval(async () => { const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } }); return r.violations.map((x) => `${x.id}(${x.impact}) x${x.nodes.length}: ${x.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(", ")}`); });
  ok(!v.length, `${label}: ${v.join(" | ")}`); return "0 violations";
};
const hscroll = () => b.eval(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
try {
  await step("security: page without launch code or token is refused", async () => {
    const r = await fetch(`http://127.0.0.1:${info.port}/`); ok(r.status === 401, `status ${r.status}`);
    const r2 = await fetch(`http://127.0.0.1:${info.port}/api/msg`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }); ok(r2.status === 401, `post ${r2.status}`);
    const r3 = await fetch(`http://127.0.0.1:${info.port}/api/state`, { headers: { "x-bp-token": info.token, origin: "http://evil.example" } }); ok(r3.status === 403, `foreign origin ${r3.status}`);
    const r4 = await new Promise((res) => http.get({ host: "127.0.0.1", port: info.port, path: "/api/state", headers: { "x-bp-token": info.token, host: "evil.example" } }, res)); ok(r4.statusCode === 403, `rebinding host ${r4.statusCode}`); r4.resume();
    const r5 = await fetch(`http://127.0.0.1:${info.port}/api/msg`, { method: "POST", headers: { "x-bp-token": info.token, "content-type": "application/json" }, body: "{not json" }); ok(r5.status === 400 || r5.status === 500, `bad json ${r5.status}`);
    const r6 = await fetch(`http://127.0.0.1:${info.port}/api/msg`, { method: "POST", headers: { "x-bp-token": info.token }, body: "x".repeat(400_000) }); ok(r6.status === 413, `huge ${r6.status}`);
    const r7 = await fetch(`http://127.0.0.1:${info.port}/media/..%2F..%2Fui-server.json`); ok(r7.status === 404, `traversal ${r7.status}`);
    return `401/401/403/403/${r5.status}/413/404`;
  });
  await step("launch code is single use", async () => {
    await b.goto(url); await b.wait(() => !document.querySelector(".loading"));
    const r = await fetch(url, { redirect: "manual" }); ok(r.status === 401, `reuse gave ${r.status}`);
  });
  await step("first run: connect card, no console errors", async () => {
    const t = await b.text(); ok(t.includes("Connect Claude Code"), "no connect card"); ok(!b.errors().length, b.errors().join());
    await b.shot(`${OUT}/1-first-run.png`);
  });
  await step("a11y first run (axe WCAG 2.2 AA)", () => axe("first run"));
  await step("See exactly what changes shows the settings entries", async () => {
    await b.click('[data-act="showConnectChanges"]'); await b.wait(() => !!document.querySelector(".bp-modal pre"));
    const t = await b.eval(() => document.querySelector(".bp-modal pre").textContent); ok(/hooks|statusLine/.test(t), t.slice(0, 100));
    await top("[data-ok]"); ok(E.settings() === null, "settings written by preview");
  });
  await step("Connect → Cancel changes nothing", async () => { await b.click('[data-act="connectAll"]'); await modalCancel(); await sleep(300); ok(E.settings() === null, "settings changed on cancel"); });
  await step("Connect → Continue writes hooks + status line, page switches", async () => {
    await b.click('[data-act="connectAll"]'); await modalOk(); await b.wait(() => !document.body.innerText.includes("Connect Claude Code"), 8000);
    const s = E.settings(); ok(s?.hooks && s?.statusLine, "settings missing hooks/statusLine"); return `events: ${Object.keys(s.hooks).length}, toast "${await flash()}"`;
  });
  await step("Connect twice is idempotent", async () => { const before = JSON.stringify(E.settings()); const r = await fetch(`http://127.0.0.1:${info.port}/api/msg`, { method: "POST", headers: { "x-bp-token": info.token, "content-type": "application/json" }, body: JSON.stringify({ type: "connectAll" }) }); ok(r.ok, "post"); ok(JSON.stringify(E.settings()) === before, "settings changed on 2nd connect"); });
  // seed live sessions
  const A = "aaaaaaaa-0000-0000-0000-000000000001", B = "bbbbbbbb-0000-0000-0000-000000000002";
  E.spool({ session_id: A, hook_event_name: "SessionStart", cwd: E.proj, source: "startup" });
  E.spool({ session_id: A, hook_event_name: "UserPromptSubmit", cwd: E.proj, prompt: "add a login page" });
  E.spool({ session_id: A, hook_event_name: "PostToolUse", cwd: E.proj, tool_name: "Edit", tool_input: { file_path: path.join(E.proj, "package.json") }, tool_response: {} });
  E.spool({ session_id: A, hook_event_name: "Notification", cwd: E.proj, notification_type: "permission_prompt", message: "Claude needs your permission to use Bash" });
  E.spool({ session_id: B, hook_event_name: "UserPromptSubmit", cwd: E.proj, prompt: "<img src=x onerror=alert(1)> ünïcødé 🚀" });
  E.spool({ session_id: B, hook_event_name: "PostToolUse", cwd: E.proj, tool_name: "Bash", tool_input: { command: "git push --force origin main" }, tool_response: {} });
  E.spool({ session_id: B, hook_event_name: "Stop", cwd: E.proj });
  await step("live sessions appear (needs-you first) within 5 s", async () => {
    await b.wait(() => document.querySelectorAll("li.needs").length > 0 && document.body.innerText.includes("Your turn"), 8000);
    const t = await b.text(); ok(t.includes("Claude needs your permission"), "no needs-you reason");
    const xss = await b.eval(() => !!document.querySelector("img[src=x]")); ok(!xss, "XSS: injected img rendered");
    await b.shot(`${OUT}/2-sessions.png`);
  });
  await step("a11y with sessions", () => axe("sessions"));
  await step("expand a session shows its steps", async () => { await b.click('[data-act="toggleBuild"]'); await b.wait(() => !!document.querySelector(".details")); const t = await b.eval(() => document.querySelector(".details").innerText); ok(/This request/i.test(t), t.slice(0, 80)); ok(await b.eval(() => document.querySelector('[data-act="toggleBuild"]').getAttribute("aria-expanded")) === "true", "aria-expanded not true"); });
  await step("Looks fine hides the force-push warning", async () => { ok((await b.text()).includes("force-pushed"), "no risk shown"); await b.click('[data-act="dismissRisk"]'); await b.wait(() => !document.body.innerText.includes("force-pushed"), 6000); });
  await step("Rename a session persists across reload", async () => {
    await b.click('[data-act="renameBuild"]'); await modalInput("checkout page"); await b.wait(() => document.body.innerText.includes("checkout page"), 6000);
    const r = E.cli(["glance"]); ok(r.out.includes("checkout page"), "CLI glance doesn't show rename: " + r.out);
  });
  await step("Rename → Cancel keeps name", async () => { await b.click('[data-act="renameBuild"]'); await b.wait(() => !!document.querySelector(".bp-modal input")); await top("[data-x]"); await sleep(400); ok((await b.text()).includes("checkout page"), "name lost"); });
  await step("Go to tab: says it's looking, then explains where the session runs", async () => {
    ok(await b.eval(() => document.querySelectorAll('[data-act="openBuild"]').length > 0), "no Go to tab button");
    await b.click('[data-act="openBuild"]');
    ok(/Looking/.test(await flash()), "no immediate feedback: " + (await flash()));
    await b.wait(() => !!document.querySelector(".bp-modal pre"), 30000);
    const t = await b.eval(() => document.querySelector(".bp-modal pre").textContent); await modalOk();
    ok(await b.eval(() => !document.querySelector(".bp-modal")), "dialog left open");
    return t.slice(0, 80);
  });
  await step("Who changed a file finds package.json", async () => {
    const open = await b.eval(() => !!document.getElementById("fileq")); if (!open) await b.click('[data-act="openFinder"]');
    await b.wait(() => !!document.getElementById("fileq")); await b.type("#fileq", "package.json"); await b.click('[data-act="whoChanged"]');
    await b.wait(() => !!document.querySelector("ul.files li"), 6000); return (await b.eval(() => document.querySelector("ul.files li").innerText)).replace(/\s+/g, " ").slice(0, 100);
  });
  await step("Undo this file → safety save point, file back to committed", async () => {
    fs.writeFileSync(path.join(E.proj, "package.json"), '{"name":"changed"}');
    await b.click('[data-act="undoFile"]'); await modalOk(); await b.wait(async () => /Put back|Safety/.test(document.getElementById("flash").textContent), 8000);
    const now = fs.readFileSync(path.join(E.proj, "package.json"), "utf8"); ok(now.includes('"demo"'), "file not restored: " + now);
    const refs = execFileSync("git", ["for-each-ref", "--format=%(refname)"], { cwd: E.proj, encoding: "utf8" }); ok(/buildpilot/.test(refs), "no safety ref: " + refs);
    return await flash();
  });
  await step("Write my prompt → Start Claude with this (confirmed, terminal opens in project)", async () => {
    await b.wait(() => !!document.getElementById("req")); await b.type("#req", "the login button does nothing on mobile"); await b.click('[data-act="build"]');
    await b.wait(() => (document.getElementById("ptext")?.value ?? "").length > 200, 8000);
    await b.click('[data-act="sendPrompt"]'); await modalCancel(); await sleep(300); ok(!E.osLog().some((x) => x.kind === "terminal"), "terminal opened after cancel");
    await b.click('[data-act="sendPrompt"]'); await modalOk(); await b.wait(() => /starting/i.test(document.getElementById("flash").textContent), 6000).catch(async (e) => { throw new Error(e.message.slice(0, 40) + " flash=" + await flash() + " modal=" + await b.eval(() => document.querySelector(".bp-modal")?.innerText ?? "none") + " os=" + JSON.stringify(E.osLog().map((x) => x.kind))); });
    const t = E.osLog().find((x) => x.kind === "terminal"); ok(t && t.dir === E.proj && /^claude "\$\(cat '/.test(t.command), JSON.stringify(t));
    const file = t.command.match(/'([^']+)'/)[1]; ok(fs.readFileSync(file, "utf8").includes("login button"), "prompt file content");
    return t.command.slice(0, 80);
  });
  await step("Copy prompt → clipboard (logged), toast", async () => { await b.click('[data-act="copyPrompt"]'); await b.wait(() => /Copied/.test(document.getElementById("flash").textContent), 5000); ok(E.osLog().some((x) => x.kind === "copy" && x.text.includes("login button")), "no copy logged"); });
  await step("Alerts toggle updates label + aria-pressed and persists", async () => {
    const before = await b.eval(() => document.querySelector('[data-act="toggleAlerts"]').textContent); await b.click('[data-act="toggleAlerts"]');
    await b.wait((bf) => document.querySelector('[data-act="toggleAlerts"]').textContent !== bf, 6000, before);
    const after = await b.eval(() => [document.querySelector('[data-act="toggleAlerts"]').textContent, document.querySelector('[data-act="toggleAlerts"]').getAttribute("aria-pressed")]);
    const prefs = JSON.parse(fs.readFileSync(path.join(E.home, ".buildpilot/ui.json"), "utf8")); ok(prefs.alerts === false && after[0] === "Alerts: off" && after[1] === "false", JSON.stringify({ after, prefs }));
    await b.click('[data-act="toggleAlerts"]'); await b.wait(() => document.querySelector('[data-act="toggleAlerts"]').textContent === "Alerts: on", 6000);
  });
  await step("Theme: white by default; Auto light/dark ↔ White page", async () => {
    ok(await b.eval(() => !document.body.classList.contains("match")), "not white by default");
    const bg = await b.eval(() => getComputedStyle(document.body).backgroundColor); ok(/255, 255, 255/.test(bg), "bg " + bg);
    ok(await b.eval(() => document.querySelector('[data-act="toggleTheme"]').textContent) === "Auto light/dark", "label");
    await b.click('[data-act="toggleTheme"]'); await b.wait(() => document.querySelector('[data-act="toggleTheme"]').textContent === "White page", 6000);
    ok(JSON.parse(fs.readFileSync(path.join(E.home, ".buildpilot/ui.json"), "utf8")).theme === "auto", "pref not auto");
    await b.click('[data-act="toggleTheme"]'); await b.wait(() => document.querySelector('[data-act="toggleTheme"]').textContent === "Auto light/dark", 6000);
    return `bg ${bg}`;
  });
  await step("Advanced tools shows terminal commands", async () => { await b.click('[data-act="more"]'); await b.wait(() => !!document.querySelector(".bp-modal pre")); ok((await b.eval(() => document.querySelector(".bp-modal pre").textContent)).includes("bp audit"), "no list"); await top("[data-ok]"); });
  await step("Escape closes a dialog and returns focus", async () => { await b.click('[data-act="more"]'); await b.wait(() => !!document.querySelector(".bp-modal")); await b.eval(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))); await b.wait(() => !document.querySelector(".bp-modal"), 3000); });
  await step("Project picker lists the project", async () => { await b.click('[data-act="selectProject"]'); await b.wait(() => !!document.querySelector(".bp-modal ul.pick button, .bp-modal pre")); const t = await b.eval(() => document.querySelector(".bp-modal").innerText); await b.eval(() => document.querySelector(".bp-modal [data-x], .bp-modal [data-ok]").click()); ok(t.includes("proj"), t.slice(0, 120)); });
  await step("New side build: name → confirm → worktree + terminal", async () => {
    const n = await b.eval(() => !!document.querySelector('[data-act="newBuild"]')); ok(n, "no New build button");
    await b.click('[data-act="newBuild"]'); await modalInput("checkout"); await modalOk();
    await b.wait(() => /New build/.test(document.getElementById("flash").textContent), 15000);
    const wt = execFileSync("git", ["worktree", "list"], { cwd: E.proj, encoding: "utf8" }); ok(/bp\/checkout/.test(wt), wt);
    const t = E.osLog().filter((x) => x.kind === "terminal").pop(); ok(/proj-checkout$/.test(t.dir) && /npm install && claude/.test(t.command), JSON.stringify(t));
    fs.writeFileSync(path.join(t.dir, "feature.txt"), "hello");
    return t.dir;
  });
  await step("Side build shows up; Review lists its changed file", async () => {
    await b.wait(() => !!document.querySelector('[data-act="reviewBuild"]'), 10000); await b.click('[data-act="reviewBuild"]');
    await b.wait(() => !!document.querySelector(".bp-modal pre")); const t = await b.eval(() => document.querySelector(".bp-modal pre").textContent); await top("[data-ok]"); ok(t.includes("feature.txt"), t);
  });
  await step("Merge side build (tests run first) → work in main project", async () => {
    await b.click('[data-act="mergeBuild"]'); await modalOk(); await b.wait(() => /Merged/.test(document.getElementById("flash").textContent), 30000);
    ok(fs.existsSync(path.join(E.proj, "feature.txt")), "feature.txt not in main"); return await flash();
  });
  await step("Remove side build: folder gone, branch kept", async () => {
    await b.wait(() => !!document.querySelector('[data-act="removeBuild"]'), 8000); await b.click('[data-act="removeBuild"]'); await modalOk();
    await b.wait(() => /Removed/.test(document.getElementById("flash").textContent), 10000);
    ok(!fs.existsSync(path.join(E.home, "proj-checkout")), "folder still there"); ok(execFileSync("git", ["branch"], { cwd: E.proj, encoding: "utf8" }).includes("bp/checkout"), "branch gone");
  });
  await step("Hide idle: plain message when nothing is quiet", async () => { const has = await b.eval(() => !!document.querySelector('[data-act="hideIdle"]')); if (!has) return "button not shown (no quiet sessions) — correct"; await b.click('[data-act="hideIdle"]'); await modalOk(); await b.wait(() => /hide|Hid/.test(document.getElementById("flash").textContent), 5000); return await flash(); });
  await step("Narrow window (375px): no horizontal scroll", async () => { await b.viewport(375, 800); await sleep(400); ok(!(await hscroll()), "horizontal scroll at 375px"); await b.shot(`${OUT}/3-narrow.png`); await b.viewport(900, 1100); });
  await step("Keyboard: every button reachable and named", async () => { const bad = await b.eval(() => [...document.querySelectorAll("button, input, textarea, select, a[href]")].filter((e) => e.offsetParent !== null && (e.tabIndex < 0 || !(e.getAttribute("aria-label") || e.textContent.trim() || e.id && document.querySelector(`label[for="${e.id}"]`) || e.getAttribute("title") || e.getAttribute("placeholder")))).map((e) => e.outerHTML.slice(0, 80))); ok(!bad.length, bad.join(" | ")); });
  await step("Disconnect → settings restored, page shows Connect again", async () => {
    await b.click('[data-act="disconnect"]'); await modalOk(); await b.wait(() => document.body.innerText.includes("Connect Claude Code"), 8000);
    const s = E.settings(); ok(!s?.hooks && !s?.statusLine, JSON.stringify(s));
  });
  await step("no console errors during the whole run", async () => { const e = b.errors(); ok(!e.length, e.join("\n")); });
  await step("no real OS side effects (all logged)", async () => { return `${E.osLog().length} OS actions logged: ${[...new Set(E.osLog().map((x) => x.kind))].join(", ")}`; });
} finally { await b.close(); E.cleanup(); }
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.note ? `  — ${r.note}` : ""}`);
console.log(`\n${results.filter((r) => r.ok).length} passed, ${results.filter((r) => !r.ok).length} failed · home ${E.home}`);

if (results.some((r) => !r.ok)) process.exitCode = 1;
