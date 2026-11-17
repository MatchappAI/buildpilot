// Live-window journeys found by operating the real UI (live QA 2026-11-16). Real `bp ui` server on a seeded temp HOME,
// headless Chrome, real mouse presses and key events. Each step repeats a sequence that used to fail.
import fs from "fs"; import os from "os"; import path from "path"; import { execFileSync } from "child_process";
import { launch } from "./cdp.mjs"; import { makeEnv, REPO } from "./env.mjs"; import { seed, IDS } from "./seed.mjs";
const OUT = process.argv[2] ?? path.join(os.tmpdir(), "bp-e2e-live"); fs.mkdirSync(OUT, { recursive: true });
const E = makeEnv(); E.cli(["hooks", "install"]); E.cli(["statusline", "install"]);
const S = seed(E);
setTimeout(() => { console.error("ui-live: gave up after 5 min"); E.cleanup(); process.exit(2); }, 300_000).unref();
const { url, info } = await E.startUi(); const b = await launch({ width: 1280, height: 900 });
const res = []; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { if (!c) throw new Error(m); };
const step = async (name, fn) => { try { const n = await Promise.race([fn(), new Promise((_, j) => setTimeout(() => j(new Error("step took over 60 s")), 60000))]); res.push(["PASS", name, n ?? ""]); } catch (e) { res.push(["FAIL", name, String(e.message).slice(0, 300)]); } };
const flash = () => b.eval(() => document.getElementById("flash")?.textContent ?? "");
const modals = () => b.eval(() => document.querySelectorAll(".bp-modal").length);
const terminals = () => E.osLog().filter((x) => x.kind === "terminal").length;
const axeSrc = fs.readFileSync(path.join(REPO, "node_modules/axe-core/axe.min.js"), "utf8");
let n = 0; const liveEvent = () => { const f = path.join(E.home, ".buildpilot/spool", `evt.live${n++}.json`); fs.writeFileSync(f, JSON.stringify({ session_id: IDS.working, cwd: S.shop, hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: path.join(S.shop, `src/f${n}.ts`) }, tool_response: {} })); };
const whileLive = async (ms, fn) => { const t = setInterval(liveEvent, 700); try { return await fn(); } finally { await sleep(ms); clearInterval(t); } };
try {
  await b.viewport(1280, 900); await b.goto(url); await b.wait(() => !!document.querySelector(".builds") && !!document.querySelector(".hu-need"), 15000); await sleep(800);
  await step("seeded day: needs-you line names the exact session, no Pause for an idle session", async () => {
    const t = await b.eval(() => document.querySelector(".hu-need").textContent); ok(/proj \(clean the old build\) needs your OK/.test(t), t);
    ok(await b.eval(() => !document.querySelector('[data-tip="pause"]')), "Pause offered for a session that isn't working");
    await b.shot(`${OUT}/live-1-seeded.png`, false); return t.trim().slice(0, 60);
  });
  await step("seeded day: Start fresh never overlaps the chat % (desktop) and no sideways scroll at 375 px", async () => {
    const overlap = await b.eval(() => [...document.querySelectorAll(".builds > li")].some((li) => { const m = li.querySelector(".b-meta")?.getBoundingClientRect(); const a = [...li.querySelectorAll(".b-act > *")].map((x) => x.getBoundingClientRect()); return m && a.some((r) => r.left < m.right - 1 && r.right > m.left && r.top < m.bottom && r.bottom > m.top); }));
    ok(!overlap, "action button overlaps the chat % column");
    await b.viewport(375, 800, true); await sleep(300); const hs = await b.eval(() => document.documentElement.scrollWidth > innerWidth + 1); await b.shot(`${OUT}/live-2-375.png`); await b.viewport(1280, 900); ok(!hs, "sideways scroll at 375 px");
  });
  await step("seeded day: axe WCAG 2.2 AA", async () => {
    await b.eval((src) => { if (!window.axe) { const s = document.createElement("script"); s.textContent = src; document.head.appendChild(s); } return true; }, axeSrc);
    const v = await b.eval(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] } })).violations.map((x) => `${x.id} x${x.nodes.length}`)); ok(!v.length, v.join(" | ")); return "0 violations";
  });
  await step("rename with Enter closes the box, and renaming again works (twice)", async () => {
    for (const name of ["cleanup", "cleanup 2"]) {
      await b.press(`[data-act="renameBuild"][data-id="${IDS.approve}"]`); await b.wait(() => !!document.querySelector(".bp-modal input"), 4000);
      await b.typeKeys(name); await b.key("Enter"); await sleep(500); ok((await modals()) === 0, `dialog still open after Enter (${name})`);
      await b.wait((x) => document.body.innerText.includes(x), 6000, name);
    }
    ok(E.cli(["glance"]).out.includes("cleanup 2"), "CLI doesn't show the name");
  });
  await step("typing in Who changed a file? while sessions update keeps the text", async () => {
    await b.press('[data-act="openFinder"]'); await b.wait(() => document.activeElement?.id === "fileq");
    const v = await whileLive(300, async () => { await b.typeKeys("check"); await sleep(3500); await b.typeKeys("out"); await sleep(3500); return b.eval(() => document.getElementById("fileq").value); });
    ok(v === "checkout", `box now says "${v}"`); await b.key("Enter"); await b.wait(() => !!document.querySelector("ul.files li"), 6000);
    return (await b.eval(() => document.querySelector("ul.files li").innerText)).replace(/\s+/g, " ").slice(0, 70);
  });
  await step("slow network: Write my prompt says Writing… and a double click sends once", async () => {
    await b.throttle(1200); await b.press("#req"); await b.typeKeys("add a dark mode toggle"); b.events.length = 0;
    await b.press('[data-act="build"]', { count: 2, gap: 60 }); await sleep(250);
    const label = await b.eval(() => document.querySelector('[data-act="build"]').textContent);
    await b.wait(() => (document.getElementById("ptext")?.value ?? "").includes("dark mode"), 20000); await b.throttle(0);
    const posts = b.events.filter((e) => e.method === "Network.requestWillBeSent" && e.params.request.url.endsWith("/api/msg") && /buildPrompt/.test(e.params.request.postData ?? "")).length;
    ok(label === "Writing…", `label "${label}"`); ok(posts === 1, `${posts} buildPrompt requests`); return `1 request, label "${label}"`;
  });
  await step("prompt editing: selection and scroll survive live updates", async () => {
    await b.eval(() => { const t = document.getElementById("ptext"); t.focus(); t.setSelectionRange(10, 60); t.scrollTop = 120; });
    const r = await whileLive(300, async () => { await sleep(4000); return b.eval(() => { const t = document.getElementById("ptext"); return [document.activeElement === t, t.selectionStart, t.selectionEnd, t.scrollTop]; }); });
    ok(r[0] && r[1] === 10 && r[2] === 60 && r[3] === 120, JSON.stringify(r));
  });
  await step("double press on Start Claude with this: one dialog, one terminal", async () => {
    const before = terminals(); await b.press('[data-act="sendPrompt"]', { count: 2, gap: 60 }); await sleep(400);
    const m = await modals(); ok(m === 1, `${m} dialogs`); await b.key("Enter"); await sleep(1200); ok(terminals() === before + 1, `${terminals() - before} terminals`);
  });
  await step("reload keeps the written prompt and what it was for", async () => {
    const p = await b.eval(() => document.getElementById("ptext").value); await b.reload(); await b.wait(() => !!document.getElementById("ptext"), 10000);
    ok((await b.eval(() => document.getElementById("ptext").value)) === p, "prompt lost on reload"); ok(/dark mode toggle/.test(await b.eval(() => document.querySelector(".summary").textContent)), "summary names a different request");
  });
  await step("project picker lists blog (a folder Claude worked in); the choice survives a reload; back to proj", async () => {
    await b.press('[data-act="selectProject"]'); await b.wait(() => !!document.querySelector(".bp-modal [data-n]"));
    const names = await b.eval(() => [...document.querySelectorAll(".bp-modal [data-n]")].map((x) => x.textContent.split(" ")[0])); const i = names.indexOf("blog"); ok(i >= 0, names.join());
    await b.press(`.bp-modal [data-n="${i}"]`); await b.wait(() => /Project: blog/.test(document.body.innerText), 10000);
    await b.reload(); await b.wait(() => /Project: blog/.test(document.body.innerText), 10000);
    await b.press('[data-act="selectProject"]'); await b.wait(() => !!document.querySelector(".bp-modal [data-n]")); const j = (await b.eval(() => [...document.querySelectorAll(".bp-modal [data-n]")].map((x) => x.textContent.split(" ")[0]))).indexOf("proj");
    await b.press(`.bp-modal [data-n="${j}"]`); await b.wait(() => /Project: (proj|demo)/.test(document.body.innerText), 10000); return names.join(", ");
  });
  await step("side build: abandon at the name box and at the confirm leaves nothing behind", async () => {
    await b.press('[data-act="newBuild"]'); await b.wait(() => !!document.querySelector(".bp-modal input")); await b.key("Escape"); await sleep(300);
    await b.press('[data-act="newBuild"]'); await b.wait(() => !!document.querySelector(".bp-modal input")); await b.typeKeys("search"); await b.key("Enter");
    await b.wait(() => /Start a new build/.test(document.querySelector(".bp-modal")?.innerText ?? "")); await b.key("Escape"); await sleep(500);
    const wt = execFileSync("git", ["worktree", "list"], { cwd: S.shop, encoding: "utf8" }).trim().split("\n").length; ok(wt === 1, `${wt} worktrees`); ok((await modals()) === 0, "dialog left open");
  });
  await step("side build: create → change → merge → remove; the list is current right away", async () => {
    await b.press('[data-act="newBuild"]'); await b.wait(() => !!document.querySelector(".bp-modal input")); await b.typeKeys("dark mode"); await b.key("Enter");
    await b.wait(() => /Start a new build/.test(document.querySelector(".bp-modal")?.innerText ?? "")); await b.key("Enter"); await b.wait(() => /New build/.test(document.getElementById("flash").textContent), 20000);
    const dir = E.osLog().filter((x) => x.kind === "terminal").pop().dir; fs.writeFileSync(path.join(dir, "src/theme.ts"), "export const dark = true;\n");
    await b.wait(() => !!document.querySelector('[data-act="mergeBuild"]'), 15000); await b.press('[data-act="mergeBuild"]'); await b.key("Enter");
    await b.wait(() => /Merged/.test(document.getElementById("flash").textContent), 60000); ok(fs.existsSync(path.join(S.shop, "src/theme.ts")), "not merged");
    await b.wait(() => !!document.querySelector('[data-act="removeBuild"]'), 10000); await b.press('[data-act="removeBuild"]'); await b.key("Enter");
    await b.wait(() => /Removed/.test(document.getElementById("flash").textContent), 15000); await sleep(400);
    ok(await b.eval(() => !document.querySelector(".side")), "removed side build still listed"); ok(!fs.existsSync(dir), "folder still there");
  });
  await step("two tabs: a rename shows in the other tab; Disconnect in one tab shows in both; reconnect", async () => {
    const t2 = await b.newTab(); await t2.goto(E.cli(["ui", "--print"]).out.trim()); await t2.wait(() => !!document.querySelector(".builds"), 10000);
    await t2.press(`[data-act="renameBuild"][data-id="${IDS.done}"]`); await t2.wait(() => !!document.querySelector(".bp-modal input")); await t2.typeKeys("login fix"); await t2.key("Enter");
    await b.wait(() => document.body.innerText.includes("login fix"), 8000);
    await t2.press('[data-act="disconnect"]'); await t2.key("Enter"); await b.wait(() => document.body.innerText.includes("Connect Claude Code"), 8000);
    await b.press('[data-act="connectAll"]'); await b.key("Enter"); await t2.wait(() => !document.body.innerText.includes("Connect Claude Code"), 8000); await t2.close();
  });
  await step("rapid clicks on Alerts (5×) end in the state the file says", async () => {
    await b.press('[data-act="toggleAlerts"]', { count: 5, gap: 30 }); await sleep(2500);
    const label = await b.eval(() => document.querySelector('[data-act="toggleAlerts"]').textContent); const pref = JSON.parse(fs.readFileSync(path.join(E.home, ".buildpilot/ui.json"), "utf8")).alerts !== false;
    ok(label === `Alerts: ${pref ? "on" : "off"}`, `${label} vs file ${pref}`); return label;
  });
  await step("no console errors so far", async () => { ok(!b.errors().length, b.errors().join(" | ")); });
  await step("server stops: a red line says so, the press says nothing changed, no uncaught errors", async () => {
    process.kill(info.pid, "SIGTERM"); await sleep(1000); b.clearErrors();
    await b.press('[data-act="toggleAlerts"]'); await sleep(800); const t = await flash();
    await b.wait(() => !!document.getElementById("bp-offline"), 8000); await b.shot(`${OUT}/live-3-offline.png`, false);
    ok(/Nothing was changed/.test(t), `toast "${t}"`); const unc = b.errors().filter((e) => /exceptionDetails|Uncaught/.test(e)); ok(!unc.length, unc.join(" | "));
    return await b.eval(() => document.getElementById("bp-offline").textContent.slice(0, 60));
  });
} finally { await b.close(); E.cleanup(); }
for (const r of res) console.log(r.join("  "));
console.log(`\n${res.filter((r) => r[0] === "PASS").length} passed, ${res.filter((r) => r[0] === "FAIL").length} failed`);
if (res.some((r) => r[0] === "FAIL")) process.exitCode = 1;
