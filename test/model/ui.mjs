// The window itself: headless Chrome (--headless=new, nothing on screen) on the REAL `bp ui --serve`, random seeded
// sequences of real mouse presses, key presses, typing (fuzz corpus), dialog answers, reloads, a second tab, slow and
// dropped network, server stop/restart, phone width and dark mode, mixed with changes made behind the window's back
// (hook events, CLI side builds, API calls). After every step: no uncaught errors / console errors / 5xx, and the page
// shows what the server says.
import fs from "fs"; import path from "path";
import { launch } from "../e2e/cdp.mjs"; import { seed as seedDay } from "../e2e/seed.mjs";
import { makeServerWorld } from "./api.mjs";
import { TEXT } from "./fuzz.mjs";
import { rng } from "./rng.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BAD = /\bundefined\b|\bNaN\b|\[object Object\]/;

/** Which screen the page is on (the UI state for coverage). */
async function pageState(b, env) {
  if (env.down) return "server-down";
  const d = await b.eval(() => {
    const m = [...document.querySelectorAll(".bp-modal")].pop();
    if (m) return m.querySelector("input") ? "dialog:input" : m.querySelector("[data-n]") || /Choose a project/.test(m.innerText) ? "dialog:pick" : m.querySelector("[data-x]") ? "dialog:confirm" : "dialog:show";
    if (document.getElementById("bp-offline")) return "offline";
    if (/expired/i.test(document.body.innerText) && !document.querySelector(".page")) return "expired";
    if (document.querySelector(".connect")) return "connect";
    if (document.querySelector(".paywall")) return "paywall";
    if (document.getElementById("ptext")) return "prompt-written";
    if (document.getElementById("fileq")) return "finder";
    return document.querySelector(".page") ? "sessions" : "loading";
  }).catch(() => "loading");
  return d;
}

export async function runUiWalk({ B, R, steps = 120, seq = null, cfg = {}, record, shots = null }) {
  const W = await makeServerWorld(B, cfg);
  W.__key = () => B.mint();
  if (cfg.connected) { W.cli(["hooks", "install"]); W.cli(["statusline", "install"]); }
  if (cfg.seeded) seedDay({ proj: W.proj, home: W.home, env: W.env });
  if (cfg.theme || cfg.alerts) fs.writeFileSync(path.join(W.bph, "ui.json"), JSON.stringify({ theme: cfg.theme ?? "white", alerts: cfg.alerts !== "off" }));
  if (cfg.noGit) fs.rmSync(path.join(W.proj, ".git"), { recursive: true, force: true });
  await W.stop(); await W.start(); // reads the seeded spool
  const env = { down: false, offline: false, throttle: 0, dark: cfg.scheme === "dark", narrow: cfg.viewport === "phone" };
  const b = await launch({ width: 1280, height: 900 });
  const openUrl = async (tab = b) => { const u = W.cli(["ui", "--print"]).out.trim(); await tab.goto(u); await tab.wait(() => !!document.querySelector(".page") || !!document.querySelector(".connect"), 15000); };
  const log = []; const failures = [];
  let tab2 = null;
  const total = seq ? seq.length : steps;
  try {
    await b.viewport(env.narrow ? 375 : 1280, env.narrow ? 800 : 900, env.narrow);
    await b.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: env.dark ? "dark" : "light" }] }); // known start, whatever this Mac uses
    await openUrl();
    for (let step = 0; step < total; step++) {
      const st = await pageState(b, env);
      const options = await actionsFor(b, st, env);
      // Each step carries its own sub-seed, so a recorded sequence replays the same choices (and can be shrunk).
      let name = seq ? seq[step].a : null; const sub = seq ? seq[step].s : R.int(0, 2 ** 31);
      if (!name) name = R.weighted(options.map((o) => [o, o.startsWith("press:") || o.startsWith("dlg:") ? 6 : o.startsWith("type:") ? 3 : 1]));
      if (!options.includes(name) && seq) continue;
      const SR = rng(sub);
      b.events.length = Math.min(b.events.length, 0);
      const errsBefore = b.errors().length;
      let note = "";
      try { note = await doAction(name, { b, W, R: SR, env, openUrl, getTab2: () => tab2, setTab2: (t) => (tab2 = t) }); }
      catch (e) { const txt = await b.eval(() => document.body?.innerText?.slice(0, 200) ?? "").catch(() => "?"); if (shots) await b.shot(path.join(shots, `ui-${cfg.label ?? "x"}-${step}-ACTION.png`), false).catch(() => {}); failures.push({ step, action: name, state: st, errors: [`action failed: ${e.message.slice(0, 240)}`, `page: ${txt}`], url: await b.eval(() => location.href).catch(() => "?") }); log.push({ a: name, s: sub }); break; }
      log.push({ a: name, s: sub });
      await settle(b, env);
      const after = await pageState(b, env);
      record?.transition("page", st, name.replace(/:(?:[a-z0-9-]+)$/i, (x) => (name.startsWith("type:") || name.startsWith("dlg:type") ? "" : x)), after);
      if (log.length > 1) record?.pair("page", log[log.length - 2].a, name);
      const errs = await checkUi(b, W, env, errsBefore, name);
      if (shots && (errs.length || SR.chance(0.03))) await b.shot(path.join(shots, `ui-${cfg.label ?? "x"}-${step}${errs.length ? "-FAIL" : ""}.png`), false).catch(() => {});
      if (errs.length) { failures.push({ step, action: name, state: st, note, errors: errs }); break; }
    }
  } finally { try { await tab2?.close(); } catch {} await b.close(); await W.cleanup(); }
  return { steps: log.length, log, failures };
}

/** Every action possible right now on this screen. */
async function actionsFor(b, st, env) {
  if (env.down) return ["env:serverStart", "env:reload"];
  const acts = await b.eval(() => [...new Set([...document.querySelectorAll("[data-act]")].filter((e) => e.getClientRects().length && !e.closest("[aria-hidden=true]")).map((e) => e.dataset.act + (e.dataset.tip ? `.${e.dataset.tip}` : "")))]).catch(() => []);
  const out = [];
  if (st.startsWith("dialog")) {
    out.push("dlg:esc", "dlg:backdrop");
    if (st === "dialog:input") out.push("dlg:type", "dlg:cancel", "dlg:ok");
    else if (st === "dialog:pick") out.push("dlg:pick", "dlg:cancel");
    else if (st === "dialog:confirm") out.push("dlg:ok", "dlg:cancel", "dlg:enter");
    else out.push("dlg:ok", "dlg:enter");
    return out;
  }
  if ((st === "offline" || st === "expired" || env.stale) && !env.offline) out.push("env:reopen");
  for (const a of acts) out.push(`press:${a}`);
  const has = await b.eval(() => ({ req: !!document.getElementById("req"), fileq: !!document.getElementById("fileq"), ptext: !!document.getElementById("ptext"), rows: document.querySelectorAll(".builds .name-btn").length })).catch(() => ({}));
  if (has.req) out.push("type:req", "key:cmdEnter");
  if (has.fileq) out.push("type:fileq");
  if (has.ptext) out.push("type:ptext");
  if (has.rows) out.push("key:j", "key:k", "key:g");
  out.push("key:/", "key:tab", "key:esc", "env:reload", "env:secondTab", "env:throttle", env.offline ? "env:online" : "env:offline", "env:serverStop", "env:serverRestart", "env:narrow", "env:dark", "bg:claudeEvent", "bg:apiRename", "bg:cliNew", "bg:apiHideIdle", "bg:editBuild");
  return out;
}

async function doAction(name, { b, W, R, env, openUrl }) {
  const [kind, arg] = [name.slice(0, name.indexOf(":")), name.slice(name.indexOf(":") + 1)];
  if (kind === "press") {
    const [act, tip] = arg.split(".");
    const sel = `[data-act="${act}"]${tip ? `[data-tip="${tip}"]` : ""}`;
    const n = await b.eval((s) => [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length).length, sel);
    const i = R.int(0, Math.max(0, n - 1));
    await b.eval((s, k) => { const e = [...document.querySelectorAll(s)].filter((x) => x.getClientRects().length)[k]; e?.setAttribute("data-model-target", "1"); }, sel, i);
    await b.press('[data-model-target="1"]', { count: R.chance(0.12) ? 2 : 1, gap: 50 }).catch(() => {});
    await b.eval(() => document.querySelectorAll("[data-model-target]").forEach((e) => e.removeAttribute("data-model-target"))).catch(() => {});
    return sel;
  }
  if (kind === "dlg") {
    if (arg === "esc") return b.key("Escape");
    if (arg === "enter") return b.key("Enter");
    if (arg === "ok") return b.press(".bp-modal:last-of-type [data-ok]");
    if (arg === "cancel") return b.press(".bp-modal:last-of-type [data-x]");
    if (arg === "pick") { const n = await b.eval(() => document.querySelectorAll(".bp-modal [data-n]").length); return b.press(`.bp-modal [data-n="${R.int(0, n - 1)}"]`); }
    if (arg === "backdrop") { await sleep(550); await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 4, y: 4, button: "left", clickCount: 1, buttons: 1 }); await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 4, y: 4, button: "left", clickCount: 1 }); return; }
    if (arg === "type") {
      const [cls, t] = R.pick(TEXT.filter(([c]) => c !== "huge-20k"));
      const isKey = await b.eval(() => document.querySelector(".bp-modal input")?.type === "password");
      await b.eval(() => document.querySelector(".bp-modal input")?.focus());
      await b.typeKeys(isKey && R.chance(0.5) ? W.__key?.() ?? t : t.slice(0, 120)); await b.key("Enter");
      return cls;
    }
  }
  if (kind === "type") {
    const id = arg === "req" ? "#req" : arg === "fileq" ? "#fileq" : "#ptext";
    const [cls, t] = R.pick(TEXT);
    if (t.length > 200) await b.type(id, t); else { await b.eval((s) => { const e = document.querySelector(s); e.focus(); e.select?.(); }, id); await b.typeKeys(t || " "); }
    if (arg === "fileq" && R.chance(0.6)) await b.key("Enter");
    return cls;
  }
  if (kind === "key") {
    if (arg === "cmdEnter") { await b.eval(() => document.getElementById("req")?.focus()); return b.key("Enter", 4); }
    if (arg === "tab") return b.key("Tab");
    if (arg === "esc") return b.key("Escape");
    await b.eval(() => document.activeElement?.blur?.());
    if ((arg === "g") && R.chance(0.7)) await b.key("j");
    return b.key(arg);
  }
  if (name === "env:reload") { await b.reload(); if (env.stale) await sleep(300); return; }
  if (name === "env:reopen") { await openUrl(); env.stale = false; return; }
  if (name === "env:throttle") { env.throttle = env.throttle ? 0 : R.pick([600, 1500]); return b.throttle(env.throttle); }
  if (name === "env:offline") { env.offline = true; return b.offline(true); }
  if (name === "env:online") { env.offline = false; await b.offline(false); return; }
  if (name === "env:narrow") { env.narrow = !env.narrow; return b.viewport(env.narrow ? 375 : 1280, env.narrow ? 800 : 900, env.narrow); }
  if (name === "env:dark") { env.dark = !env.dark; return b.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: env.dark ? "dark" : "light" }] }); }
  if (name === "env:serverStop") { await W.stop(); env.down = true; await sleep(R.int(200, 3500)); return; }
  if (name === "env:serverStart") { await W.start(); env.down = false; env.stale = true; await sleep(300); return; }
  if (name === "env:serverRestart") { await W.stop(); await W.start(); env.stale = true; await sleep(R.int(100, 4000)); return; }
  if (name === "env:secondTab") {
    const t2 = await b.newTab(); await openUrl(t2);
    const acts = await t2.eval(() => [...document.querySelectorAll("[data-act]")].filter((e) => e.getClientRects().length).map((e) => e.dataset.act));
    const safe = acts.filter((a) => ["toggleAlerts", "toggleTheme", "toggleQuiet", "renameBuild", "connectAll", "disconnect", "hideIdle", "toggleBuild"].includes(a));
    if (safe.length) { const a = R.pick(safe); await t2.press(`[data-act="${a}"]`); await sleep(300); if (await t2.eval(() => !!document.querySelector(".bp-modal input"))) { await t2.typeKeys("from tab 2"); } if (await t2.eval(() => !!document.querySelector(".bp-modal"))) await t2.key("Enter"); await sleep(600); }
    const e2 = t2.errors(); await t2.close();
    if (e2.length) throw new Error(`second tab console errors: ${e2.join(" | ").slice(0, 300)}`);
    return;
  }
  if (name === "bg:claudeEvent") {
    const ev = R.pick(["UserPromptSubmit", "PermissionRequest", "Stop", "PostToolUseFailure", "Notification", "SessionEnd", "PostToolUse"]);
    const id = R.pick(["d1d1d1d1-0000-4000-8000-0000000000d1", "d2d2d2d2-0000-4000-8000-0000000000d2"]);
    const p = { session_id: id, cwd: R.pick([W.proj, W.home]), hook_event_name: ev, nonce: Date.now() + Math.random(), ...(ev === "UserPromptSubmit" ? { prompt: R.pick(TEXT)[1].slice(0, 300) || "x" } : ev === "Notification" ? { notification_type: "permission_prompt", message: R.pick(TEXT)[1].slice(0, 200) } : ev === "PostToolUseFailure" ? { tool_name: "Bash", tool_input: { command: "npm test" }, error: R.pick(TEXT)[1].slice(0, 300) } : ev === "PostToolUse" ? { tool_name: "Edit", tool_input: { file_path: path.join(W.proj, "src/shared.txt") }, tool_response: {} } : {}) };
    const d = path.join(W.bph, "spool"); fs.mkdirSync(path.join(d, "tmp"), { recursive: true }); const f = `e${Date.now()}${R.int(0, 1e6)}`; fs.writeFileSync(path.join(d, "tmp", f), JSON.stringify(p)); fs.renameSync(path.join(d, "tmp", f), path.join(d, `${f}.json`));
    return ev;
  }
  if (name === "bg:apiRename") { const ids = (await W.state())?.page?.builds?.map((x) => x.id) ?? []; if (ids.length) await W.msg({ type: "renameBuild", id: R.pick(ids), name: R.pick(TEXT)[1].slice(0, 80) }); return; }
  if (name === "bg:apiHideIdle") { await W.msg({ type: "hideIdle" }); return; }
  if (name === "bg:cliNew") { W.cli(["new", R.pick(["side one", "side two", "x"])]); return; }
  if (name === "bg:editBuild") { const s = (await W.state())?.page?.side ?? []; if (s.length) fs.writeFileSync(path.join(R.pick(s).dir, `edit-${Date.now()}.txt`), "x"); return; }
  throw new Error(`unknown action ${name}`);
}

/** Wait until nothing is in flight (or 15 s, which is itself a failure: a control stuck "busy"). */
async function settle(b, env) {
  await sleep(env.throttle ? 900 : 250);
  for (let i = 0; i < 60; i++) { const busy = await b.eval(() => document.querySelectorAll('[aria-busy="true"]').length).catch(() => 0); if (!busy) break; await sleep(250); }
}

async function checkUi(b, W, env, errsBefore) {
  const errs = [];
  // 1. errors: uncaught exceptions always count; console errors count unless the network/server is down on purpose.
  const all = b.errors().slice(errsBefore);
  const expectedNet = (e) => /ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE|Failed to load resource|net::ERR|status of 401/.test(e);
  for (const e of all) if (/exceptionThrown/.test(e) || /"exceptionDetails"/.test(e) ? true : !expectedNet(e)) errs.push(`console/exception: ${e.slice(0, 240)}`);
  // 2. no 5xx
  for (const e of b.events) if (e.method === "Network.responseReceived" && e.params.response.status >= 500) errs.push(`HTTP ${e.params.response.status} ${e.params.response.url}`);
  const dom = await b.eval(() => ({
    text: document.body.innerText, modals: document.querySelectorAll(".bp-modal").length, pwned: !!window.__pwned,
    hscroll: document.documentElement.scrollWidth > innerWidth + 1, busy: document.querySelectorAll('[aria-busy="true"]').length,
    connect: !!document.querySelector(".connect"), page: !!document.querySelector(".page"), offline: !!document.getElementById("bp-offline"),
    sideNames: [...document.querySelectorAll(".side .b-name")].map((e) => e.textContent.trim()),
    rows: [...document.querySelectorAll(".col-main .builds > li:not(.group):not(.quiet)")].filter((li) => !li.closest(".side") && li.querySelector(".name-btn")).length,
    quietLabel: document.querySelector('[data-act="toggleQuiet"]')?.textContent ?? null,
    alerts: document.querySelector('[data-act="toggleAlerts"]')?.textContent ?? null, match: document.body.classList.contains("match"),
    pro: [...document.querySelectorAll(".pill")].some((p) => p.textContent === "Pro"),
  })).catch((e) => ({ err: e.message }));
  if (dom.err) { errs.push(`page unreadable: ${dom.err}`); return errs; }
  if (dom.pwned) errs.push("injected script ran (window.__pwned)");
  if (BAD.test(dom.text)) errs.push(`page shows "${dom.text.match(BAD)[0]}": …${dom.text.slice(Math.max(0, dom.text.search(BAD) - 60), dom.text.search(BAD) + 40)}…`);
  if (dom.modals > 2) errs.push(`${dom.modals} dialogs stacked`);
  if (dom.hscroll) errs.push(`sideways scroll at ${env.narrow ? 375 : 1280} px`);
  if (dom.busy && !dom.modals) errs.push(`${dom.busy} controls stuck busy for 15 s`);
  if (env.down || env.offline) return errs;
  if (env.stale) { // after a restart this page's key is old: it must say so (and never pretend to be live)
    const t = await b.eval(() => document.getElementById("bp-offline")?.textContent ?? document.body.innerText.slice(0, 120));
    if (!/restarted|expired|stopped running|can.t be reached|ERR_[A-Z_]+/i.test(t)) { await sleep(env.throttle ? 8000 : 3500); const t2 = await b.eval(() => document.getElementById("bp-offline")?.textContent ?? document.body.innerText.slice(0, 120)); if (!/restarted|expired|stopped running|can.t be reached|ERR_[A-Z_]+/i.test(t2)) errs.push(`after a server restart the old page doesn't say it's out of date: "${t2.slice(0, 80)}"`); }
    return errs;
  }
  // 3. the page shows what the server says (live refresh every 3 s: allow up to 4 s to catch up).
  if (dom.modals) return errs;
  let last = [];
  for (let i = 0; i < 9; i++) {
    const s = await W.state(); if (!s) { last = ["/api/state failed"]; break; }
    const P = s.page; last = [];
    const d = i ? await b.eval(() => ({ connect: !!document.querySelector(".connect"), offline: !!document.getElementById("bp-offline"), sideNames: [...document.querySelectorAll(".side .b-name")].map((e) => e.textContent.trim()), rows: [...document.querySelectorAll(".col-main .builds > li:not(.group):not(.quiet)")].filter((li) => !li.closest(".side") && li.querySelector(".name-btn")).length, quietLabel: document.querySelector('[data-act="toggleQuiet"]')?.textContent ?? null, alerts: document.querySelector('[data-act="toggleAlerts"]')?.textContent ?? null, match: document.body.classList.contains("match"), pro: [...document.querySelectorAll(".pill")].some((p) => p.textContent === "Pro"), showingQuiet: /^Hide/.test(document.querySelector('[data-act="toggleQuiet"]')?.textContent ?? "") })) : { ...dom, showingQuiet: /^Hide/.test(dom.quietLabel ?? "") };
    if (d.offline) { last = ["red 'stopped running' line shown while the server is up and the network is on"]; }
    if (d.connect !== !P.connected) last.push(`connect card ${d.connect ? "shown" : "hidden"} but connected=${P.connected}`);
    if (P.connected) {
      const quiet = P.builds.filter((x) => !x.needsYou && !x.stopped && x.status !== "running" && Date.now() - x.lastEventAt > 2 * 3600_000);
      const active = P.builds.length - quiet.length;
      if (d.rows !== active + (d.showingQuiet ? quiet.length : 0)) last.push(`${d.rows} session rows on screen, server has ${active} active + ${quiet.length} quiet`);
      if (quiet.length && !new RegExp(`${quiet.length} quiet session`).test(d.quietLabel ?? "")) last.push(`quiet label "${d.quietLabel}" but ${quiet.length} quiet`);
      const side = (P.side ?? []).map((x) => x.name);
      if (JSON.stringify(d.sideNames) !== JSON.stringify(side)) last.push(`side builds on screen ${JSON.stringify(d.sideNames)} ≠ server ${JSON.stringify(side)}`);
    }
    if (d.alerts != null && d.alerts !== `Alerts: ${s.settings.alerts ? "on" : "off"}`) last.push(`"${d.alerts}" but alerts=${s.settings.alerts}`);
    const wantMatch = s.settings.theme === "match" || (s.settings.theme === "auto" && env.dark);
    if (d.match !== wantMatch) last.push(`dark page ${d.match} but theme=${s.settings.theme}, system dark=${env.dark}`);
    if (d.pro !== P.plan.licensed) last.push(`Pro pill ${d.pro} but licensed=${P.plan.licensed}`);
    if (!last.length) break;
    await sleep(500);
  }
  errs.push(...last);
  return errs;
}

/** Criterion (c): one pairwise row → a world in that configuration, the page checked as it opens, then a few random steps. */
export function cfgFromRow(row, B) {
  const cfg = { label: `pw-${Object.values(row).join("-")}`, sellable: row.plan !== "not-sellable", trialDays: row.plan === "trial" ? 14 : row.plan === "trial-ending" ? 2 : 0, count: row.plan === "free-exhausted" ? 20 : 3, connected: row.connection === "connected", plugin: row.connection === "plugin", seeded: row.data === "seeded", theme: row.theme, alerts: row.alerts, viewport: row.viewport, scheme: row.scheme, noGit: row.project === "no-git" };
  if (row.plan === "licensed") cfg.license = B.mint();
  return cfg;
}
