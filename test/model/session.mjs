// Session lifecycle (hook ingest → session state machine), driven in-process through the REAL spool reader + ingestor +
// store (node:sqlite file), with virtual time. The oracle below is written from the documented rules (docs/FEATURES.md,
// ingest.ts comments), not copied from the code: after every step the database and the page data must agree with it.
import fs from "fs"; import path from "path"; import os from "os"; import { createRequire } from "module";
import { rng } from "./rng.mjs";

export const S_STATES = ["absent", "unknown", "idle", "running", "awaiting_approval", "blocked", "failed", "completed", "hidden"];
const TERMINAL = new Set(["idle", "failed", "completed", "hidden"]);
/** Every input the session machine accepts. `make(ctx)` builds the hook payload; `pre(rec)` = when it is possible. */
export const S_ACTIONS = {
  "SessionStart:startup": { ev: "SessionStart", extra: { source: "startup" } },
  "SessionStart:resume": { ev: "SessionStart", extra: { source: "resume" } },
  "SessionStart:compact": { ev: "SessionStart", extra: { source: "compact" } },
  UserPromptSubmit: { ev: "UserPromptSubmit", prompt: true },
  "UserPromptSubmit:system": { ev: "UserPromptSubmit", extra: { prompt: "<cross-session-message>hi from another session</cross-session-message>" } },
  PreToolUse: { ev: "PreToolUse", tool: true },
  PostToolUse: { ev: "PostToolUse", tool: true },
  PostToolUseFailure: { ev: "PostToolUseFailure", tool: true, extra: { error: "Error: boom" } },
  "PostToolUseFailure:interrupt": { ev: "PostToolUseFailure", tool: true, extra: { is_interrupt: true } },
  PermissionRequest: { ev: "PermissionRequest", tool: true },
  "Notification:permission_prompt": { ev: "Notification", extra: { notification_type: "permission_prompt", message: "Claude needs your permission to use Bash" } },
  "Notification:idle_prompt": { ev: "Notification", extra: { notification_type: "idle_prompt", message: "Claude is waiting for your input" } },
  "Notification:agent_needs_input": { ev: "Notification", extra: { notification_type: "agent_needs_input", message: "Which database?" } },
  "Notification:other": { ev: "Notification", extra: { notification_type: "auth_success", message: "ok" } },
  Stop: { ev: "Stop" },
  StopFailure: { ev: "StopFailure", extra: { error: "rate_limit" } },
  SessionEnd: { ev: "SessionEnd", extra: { reason: "prompt_input_exit" } },
  SubagentStart: { ev: "SubagentStart", extra: { agent_type: "Explore" } },
  SubagentStop: { ev: "SubagentStop", extra: { agent_type: "Explore" } },
  PreCompact: { ev: "PreCompact" },
  "Subagent:PostToolUse": { ev: "PostToolUse", tool: true, extra: { agent_id: "agent-1" } },
  "Subagent:PermissionRequest": { ev: "PermissionRequest", tool: true, extra: { agent_id: "agent-1" } },
  "TodoWrite": { ev: "PreToolUse", todo: true },
  "UnknownEvent": { ev: "FutureHookEvent" },
  // Delivery anomalies (what real spools see):
  "Late:PostToolUse": { late: true, pre: (r) => r.exists && r.endTs != null },
  "OutOfOrder:Stop": { old: "Stop", pre: (r) => r.exists && r.events > 0 },
  "OutOfOrder:UserPromptSubmit": { old: "UserPromptSubmit", pre: (r) => r.exists && r.events > 0 },
  "OutOfOrder:SessionStart": { old: "SessionStart", pre: (r) => r.exists && r.events > 0 },
  "Duplicate": { dup: true, pre: (r) => r.exists && !!r.lastRaw },
  "RepeatLater": { repeat: true, pre: (r) => r.exists && !!r.lastRaw },
  "Malformed": { bad: true },
  // Things the user (or time) does:
  "Quiet3h": { quiet: true, pre: (r) => r.exists },
  "hideIdle": { hide: true, pre: (r) => r.exists },
  "rename": { rename: true, pre: (r) => r.exists },
};

/** What the documented rules say happens. Pure: returns the next record. */
export function spec(rec, a, p, ts, isDup) {
  const r = { ...rec };
  if (a.bad || isDup) return r; // rejected / same event delivered twice: nothing changes
  const e = p.hook_event_name;
  const ns = (() => {
    switch (e) {
      case "SessionStart": return p.source === "compact" ? null : "idle";
      case "UserPromptSubmit": case "PreToolUse": case "PostToolUse": case "PostToolUseFailure": case "SubagentStart": case "SubagentStop": case "PreCompact": return "running";
      case "PermissionRequest": return "awaiting_approval";
      case "Notification": return p.notification_type === "permission_prompt" ? "awaiting_approval" : p.notification_type === "idle_prompt" ? "idle" : p.notification_type === "agent_needs_input" ? "blocked" : null;
      case "Stop": return "idle";
      case "StopFailure": return "failed";
      case "SessionEnd": return "completed";
      default: return null;
    }
  })();
  const existed = r.exists;
  if (!existed) Object.assign(r, { exists: true, status: "unknown", events: 0, errors: 0, last: ts, ended: null, endTs: null, promptTs: null, task: null });
  const latest = !existed || ts >= r.last;
  let next = ns;
  // A subagent's tool steps, or a background hook landing within 5 s of the end of a turn, don't restart a finished session.
  if (next === "running" && existed && TERMINAL.has(r.status) && p.agent_id) next = null;
  if (next === "running" && existed && TERMINAL.has(r.status) && e !== "UserPromptSubmit" && r.endTs != null && ts >= r.endTs && ts - r.endTs < 5000) next = null;
  r.events++;
  if ((e === "PostToolUseFailure" && !p.is_interrupt) || e === "StopFailure") r.errors++;
  if (latest) {
    r.last = ts;
    if (r.status === "hidden" && e !== "SessionEnd") { r.ended = null; r.status = next ?? "completed"; }
    else if (next) r.status = next;
  }
  // Only the newest information may change what a session is (an old event that arrives late changes nothing visible).
  if (e === "SessionStart" && existed && latest) { r.ended = null; if (r.status === "hidden") r.status = next ?? "completed"; }
  if (e === "SessionEnd") { r.ended = ts; }
  if (e === "UserPromptSubmit" && p.prompt && !/^</.test(p.prompt) && (r.promptTs == null || ts >= r.promptTs)) { r.task = p.prompt.trim().slice(0, 300); r.promptTs = ts; }
  if (["Stop", "StopFailure", "SessionEnd"].includes(e)) r.endTs = Math.max(r.endTs ?? 0, ts);
  return r;
}

const fresh = () => ({ exists: false, status: "absent", events: 0, errors: 0, last: 0, ended: null, endTs: null, promptTs: null, task: null, lastRaw: null, acceptedBuckets: new Map(), name: null });
export const stateOf = (r) => (r.exists ? r.status : "absent");

const PROMPTS = ["add a checkout page", "fix the login button", "write tests for cart", "clean up the old build", "move posts to MDX"];
const TOOLS = [["Bash", { command: "npm test" }], ["Edit", { file_path: "src/a.ts" }], ["Read", { file_path: "README.md" }], ["Write", { file_path: "src/b.ts" }]];

/** One in-process world: a throwaway BuildPilot home + the real engine. */
export async function makeWorld(harnessPath, label = "s") {
  const base = path.join(os.homedir(), process.platform === "darwin" ? "Library/Caches" : ".cache");
  const root = fs.mkdtempSync(path.join(base, `bp-model-${label}.`)); // not under /tmp: temp folders are hidden as background runs
  const home = path.join(root, ".buildpilot"); const proj = path.join(root, "proj"); fs.mkdirSync(proj, { recursive: true });
  const H = createRequire(import.meta.url)(harnessPath);
  const engine = new H.Engine({ home, light: true, claudeSettingsFile: path.join(root, "settings.json") });
  await engine.start();
  const spool = path.join(home, "spool"); fs.mkdirSync(spool, { recursive: true });
  const reader = new H.SpoolReader(spool, engine.ingestor ?? engine["ingestor"], () => {});
  let n = 0;
  const deliver = (raw, ts) => { const f = path.join(spool, `evt.m${String(++n).padStart(6, "0")}.json`); fs.writeFileSync(f, raw); const t = new Date(ts); fs.utimesSync(f, t, t); reader.drain(); };
  const row = (id) => engine.store.get("SELECT * FROM sessions WHERE id = ?", [id]);
  return { H, engine, home, proj, root, deliver, row, cleanup: () => { try { engine.stop(); } catch {} fs.rmSync(root, { recursive: true, force: true }); } };
}

/** Builds the payload for an action. Returns {raw, ts, p, isDup} (raw = exact bytes delivered). */
export function payloadFor(name, a, rec, ctx) {
  const { id, cwd, now, R } = ctx;
  if (a.bad) return { raw: R.pick(["{", "[]", "{\"session_id\":\"../x\",\"hook_event_name\":\"Stop\"}", "{\"session_id\":\"" + id + "\"}", "{\"session_id\":\"" + id + "\",\"hook_event_name\":\"Stop\",\"cwd\":7}"]), ts: now, p: null, isDup: false };
  if (a.dup) { const ts = rec.lastRawTs + R.int(0, 1500); return { raw: rec.lastRaw, ts, p: JSON.parse(rec.lastRaw), isDup: true }; }
  if (a.repeat) { const ts = Math.max(now, rec.lastRawTs + 15_000); return { raw: rec.lastRaw, ts, p: JSON.parse(rec.lastRaw), isDup: false }; }
  let ev = a.ev, extra = { ...(a.extra ?? {}) }, ts = now;
  if (a.late) { ev = "PostToolUse"; ts = Math.max(rec.endTs + R.int(50, 3000), rec.last); extra = {}; }
  if (a.old) { ev = a.old; ts = rec.last - R.int(1000, 60_000); if (a.old === "SessionStart") extra = { source: "resume" }; }
  const p = { session_id: id, cwd, hook_event_name: ev, transcript_path: `/x/${id}.jsonl`, ...extra };
  if (a.prompt || ev === "UserPromptSubmit" && !extra.prompt) p.prompt = `${R.pick(PROMPTS)} #${ctx.step}`;
  if (a.tool || a.late) { const [t, i] = R.pick(TOOLS); p.tool_name = t; p.tool_input = i; p.tool_response = {}; }
  if (a.todo) { p.tool_name = "TodoWrite"; p.tool_input = { todos: [{ content: "one", status: "completed", activeForm: "Doing one" }, { content: "two", status: R.pick(["in_progress", "pending"]), activeForm: "Doing two" }] }; }
  p.nonce = ctx.step; // distinct bytes for distinct events (a real repeat is tested by RepeatLater)
  return { raw: JSON.stringify(p), ts, p, isDup: false };
}

/** Was this exact byte string accepted in a neighbouring 5-second bucket? (= "the same event delivered twice") */
const dupOf = (rec, raw, ts) => { const b = Math.floor(ts / 5000); const seen = rec.acceptedBuckets.get(raw) ?? []; return seen.some((x) => Math.abs(x - b) <= 1); };

/**
 * Runs one seeded random walk. Returns {steps, failures, coverage}. `seq` (optional) replays an exact action list
 * (used by the shrinker); otherwise actions are drawn from the seed.
 */
export async function runSessionWalk({ harness, R, steps = 300, seq = null, sessions = 3, record, covered = null }) {
  const W = await makeWorld(harness, "sess");
  const ids = Array.from({ length: sessions }, (_, i) => `aaaa000${i}-0000-4000-8000-00000000000${i}`);
  const recs = new Map(ids.map((i) => [i, fresh()]));
  // Virtual clock: starts 30 h ago, never passes real now (the page code compares with the real clock).
  let now = Date.now() - 30 * 3600_000;
  const lastAct = new Map();
  const log = [];
  const failures = [];
  const total = seq ? seq.length : steps;
  try {
    for (let step = 0; step < total; step++) {
      const planned = seq ? seq[step] : null;
      const id = planned ? planned.id : R.pick(ids);
      const rec = recs.get(id);
      let name = planned ? planned.a : null;
      if (!name) {
        const ok = Object.entries(S_ACTIONS).filter(([, a]) => !a.pre || a.pre(rec));
        // Coverage-guided: prefer a (state, action) or (previous action on this session, action) pair not run yet.
        const fresh = covered && R.chance(0.8) ? ok.filter(([k]) => !covered.t.has(`session|${stateOf(rec)}|${k}`) || (lastAct.get(id) && !covered.p.has(`session|${lastAct.get(id)}>${k}`))) : [];
        name = R.pick(fresh.length ? fresh : ok)[0];
      }
      const a = S_ACTIONS[name];
      if (a.pre && !a.pre(rec)) { if (seq) continue; else throw new Error(`generator picked a disabled action ${name}`); }
      const sub = planned?.s ?? R.int(0, 2 ** 31); const SR = rng(sub); // per-step choices replay exactly
      const gap = planned?.gap ?? SR.weighted([[SR.int(0, 400), 5], [SR.int(400, 4000), 4], [SR.int(4000, 120_000), 1]]);
      now = Math.min(Date.now() - 60_000, now + gap);
      const before = stateOf(rec);
      const entry = { id, a: name, gap, s: sub };
      if (a.quiet) {
        now = Math.min(Date.now() - 60_000, now + 3 * 3600_000);
      } else if (a.hide) {
        const vis = new Map(W.H.widgetData(W.engine, now).sessions.map((s) => [s.id, s]));
        W.H.hideQuiet(W.engine, now);
        for (const [sid, r] of recs) {
          if (!r.exists || r.ended != null) continue;
          const v = vis.get(sid);
          const pageQuiet = !!v && !v.needsYou && !v.stopped && v.status !== "running" && now - v.lastEventAt > 2 * 3600_000; // only what the page lists as quiet
          if (pageQuiet) { r.status = "hidden"; r.ended = now; }
        }
      } else if (a.rename) {
        const nm = SR.pick(["checkout", "  spaced   out  ", "", "x".repeat(60), "<b>bold</b>", "日本語 🚀"]);
        W.H.setBuildName(W.engine, id, nm);
        const norm = nm.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
        rec.name = norm || null;
      } else {
        const pl = payloadFor(name, a, rec, { id, cwd: W.proj, now, R: SR, step });
        const isDup = !a.bad && dupOf(rec, pl.raw, pl.ts);
        W.deliver(pl.raw, pl.ts);
        const next = spec(rec, a, pl.p, pl.ts, isDup);
        if (!a.bad && !isDup) { const b = Math.floor(pl.ts / 5000); next.acceptedBuckets = new Map(rec.acceptedBuckets); next.acceptedBuckets.set(pl.raw, [...(next.acceptedBuckets.get(pl.raw) ?? []), b]); next.lastRaw = pl.raw; next.lastRawTs = pl.ts; }
        Object.assign(rec, next);
        entry.ts = pl.ts;
      }
      log.push(entry);
      const after = stateOf(rec);
      record?.transition("session", before, name, after);
      const prev = lastAct.get(id); if (prev) record?.pair("session", prev, name); lastAct.set(id, name);
      // ---- invariants after every step ----
      const errs = checkSession(W, recs, now);
      if (errs.length) { failures.push({ step, action: name, id, errors: errs }); break; }
    }
  } finally { W.cleanup(); }
  return { steps: log.length, log, failures };
}

function checkSession(W, recs, now) {
  const errs = [];
  for (const [id, r] of recs) {
    const row = W.row(id);
    if (!r.exists) { if (row) errs.push(`${id}: a session was created by an event that should have been rejected`); continue; }
    if (!row) { errs.push(`${id}: session missing from the database`); continue; }
    const hidden = row.status === "completed" && row.status_reason === "Hidden as idle" && row.ended_at != null;
    const dbState = hidden ? "hidden" : row.status;
    if (dbState !== r.status) errs.push(`${id}: status ${dbState}, expected ${r.status}`);
    if ((row.ended_at != null) !== (r.ended != null)) errs.push(`${id}: ended_at ${row.ended_at}, expected ${r.ended == null ? "open" : "ended"}`);
    if (Number(row.event_count) !== r.events) errs.push(`${id}: event_count ${row.event_count}, expected ${r.events}`);
    if (Number(row.error_count) !== r.errors) errs.push(`${id}: error_count ${row.error_count}, expected ${r.errors}`);
    if (Number(row.last_event_at) !== r.last) errs.push(`${id}: last_event_at ${row.last_event_at}, expected ${r.last}`);
    if ((row.current_task ?? null) !== (r.task ?? null)) errs.push(`${id}: task "${String(row.current_task).slice(0, 40)}", expected "${String(r.task).slice(0, 40)}"`);
    const evs = Number(W.engine.store.scalar("SELECT COUNT(*) FROM events WHERE session_id = ?", [id]));
    if (evs !== r.events) errs.push(`${id}: ${evs} event rows for ${r.events} accepted events`);
  }
  // Page data agrees with itself and with the database.
  const w = W.H.widgetData(W.engine, now);
  const seen = new Set();
  for (const s of w.sessions) {
    if (seen.has(s.id)) errs.push(`widget lists ${s.id} twice`); seen.add(s.id);
    const r = recs.get(s.id);
    if (r && r.ended != null && !s.stopped) errs.push(`${s.id}: ended session listed as open`);
    if (r && r.name && s.name !== r.name) errs.push(`${s.id}: name "${s.name}", expected "${r.name}"`);
    if (s.name && s.name.length > 40) errs.push(`${s.id}: name longer than 40`);
    for (const k of ["label", "folder", "word"]) if (s[k] != null && /undefined|NaN|\[object Object\]/.test(String(s[k]))) errs.push(`${s.id}: ${k} shows "${s[k]}"`);
  }
  for (const [id, r] of recs) {
    if (!r.exists || r.ended != null || now - r.last > 11 * 3600_000) continue;
    // Shown as "unknown" (not listed after an hour): never-classified sessions, and "working" sessions silent that long.
    if ((r.status === "unknown" || r.status === "running") && now - r.last > 3600_000) continue;
    if (!seen.has(id)) errs.push(`${id}: open ${r.status} session missing from the page`);
  }
  if (w.needs !== w.sessions.filter((s) => s.needsYou).length) errs.push(`needs ${w.needs} but ${w.sessions.filter((s) => s.needsYou).length} sessions need you`);
  return errs;
}

/**
 * Several processes ingest one spool at once. Events are written in bursts (with distinct, increasing file times) while
 * K drainer processes race to read them. Afterwards every session must look exactly as if one process had read the
 * events in time order: counts, last event, final status (from the newest status-changing event).
 */
export async function runConcurrency({ harness, R, procs = 4, sessions = 5, events = 600 }) {
  const { spawn } = await import("child_process");
  const W = await makeWorld(harness, "conc");
  const spoolDir = path.join(W.home, "spool"); fs.mkdirSync(path.join(spoolDir, "tmp"), { recursive: true });
  const ids = Array.from({ length: sessions }, (_, i) => `cccc000${i}-0000-4000-8000-00000000000${i}`);
  const KINDS = [["UserPromptSubmit", "running"], ["PermissionRequest", "awaiting_approval"], ["Stop", "idle"], ["StopFailure", "failed"], ["Notification", "blocked"]];
  const ms = 6000;
  const kids = Array.from({ length: procs }, () => spawn(process.execPath, ["--no-warnings", path.join(path.dirname(new URL(import.meta.url).pathname), "drainer.mjs"), harness, W.home, String(ms)], { stdio: ["ignore", "pipe", "pipe"] }));
  const outs = kids.map((k) => { let o = "", e = ""; k.stdout.on("data", (d) => (o += d)); k.stderr.on("data", (d) => (e += d)); return new Promise((r) => k.on("exit", (code) => r({ code, o, e }))); });
  const expect = new Map(ids.map((i) => [i, { n: 0, errors: 0, last: 0, status: null }]));
  let t = Date.now() - 3600_000;
  for (let i = 0; i < events; i++) {
    const id = R.pick(ids); const [ev, st] = R.pick(KINDS);
    t += R.int(1, 40);
    const late = R.chance(0.25) ? R.int(1, 300) : 0; // a slow hook: its file lands after newer ones
    const p = { session_id: id, cwd: W.proj, hook_event_name: ev, nonce: i, ...(ev === "UserPromptSubmit" ? { prompt: `task ${i}` } : ev === "Notification" ? { notification_type: "agent_needs_input", message: "?" } : ev === "StopFailure" ? { error: "x" } : ev === "PermissionRequest" ? { tool_name: "Bash", tool_input: { command: "ls" } } : {}) };
    // Written out of order on purpose (as slow hook processes do): the file time is the event time.
    // Like spool.sh: written in tmp/, then moved in whole (a reader never sees a half-written file or a wrong time).
    const tmp = path.join(spoolDir, "tmp", `evt.c${i}`); fs.writeFileSync(tmp, JSON.stringify(p)); fs.utimesSync(tmp, new Date(t - late), new Date(t - late)); fs.renameSync(tmp, path.join(spoolDir, `evt.c${i}.json`));
    const x = expect.get(id); x.n++; if (ev === "StopFailure") x.errors++; if (t - late >= x.last) { x.last = t - late; x.status = st; }
    if (R.chance(0.08)) await new Promise((r) => setTimeout(r, R.int(1, 20)));
  }
  const results = await Promise.all(outs);
  // Whatever the drainers left behind is read by one last process.
  const reader = new W.H.SpoolReader(spoolDir, W.engine["ingestor"], () => {}); reader.drain(5000);
  const errs = [];
  for (const r of results) { if (r.code !== 0) errs.push(`drainer exited ${r.code}: ${r.e.slice(0, 200)}`); const j = JSON.parse(r.o.trim().split("\n").pop() || "{}"); if (j.errors) errs.push(`drainer hit ${j.errors} errors: ${r.e.slice(0, 300)}`); }
  const left = fs.readdirSync(spoolDir).filter((f) => f.endsWith(".json")).length;
  if (left) errs.push(`${left} events never read`);
  for (const [id, x] of expect) {
    const row = W.row(id);
    if (!row) { if (x.n) errs.push(`${id} missing`); continue; }
    if (Number(row.event_count) !== x.n) errs.push(`${id}: event_count ${row.event_count}, expected ${x.n}`);
    if (Number(row.error_count) !== x.errors) errs.push(`${id}: error_count ${row.error_count}, expected ${x.errors}`);
    if (Number(row.last_event_at) !== x.last) errs.push(`${id}: last_event_at ${row.last_event_at}, expected ${x.last}`);
    if (row.status !== x.status) errs.push(`${id}: status ${row.status}, expected ${x.status} (from the newest event)`);
  }
  const accepted = results.reduce((s, r) => { try { return s + JSON.parse(r.o.trim().split("\n").pop()).accepted; } catch { return s; } }, 0);
  W.cleanup();
  return { events, procs, accepted, errors: errs };
}

/**
 * Criterion (d) for sessions: every simple path (no state visited twice) through the session state graph, starting
 * from "absent". The graph's edges are the (state, action → state) transitions the oracle and the code agreed on in the
 * random walks; each path is replayed on its own fresh session and checked against the oracle after every step.
 */
export function sessionPaths(transitions, maxLen = 9) {
  const edges = new Map(); // state → [[action, to]]
  for (const [k, v] of Object.entries(transitions)) { const [from, a] = k.split("|"); for (const to of v.to) if (to !== from) { const list = edges.get(from) ?? []; if (!list.some(([, t]) => t === to)) list.push([a, to]); edges.set(from, list); } }
  const paths = [];
  const walk = (s, seen, acts) => { if (acts.length) paths.push([...acts]); if (acts.length >= maxLen) return; for (const [a, to] of edges.get(s) ?? []) if (!seen.has(to)) { seen.add(to); acts.push({ a, to }); walk(to, seen, acts); acts.pop(); seen.delete(to); } };
  walk("absent", new Set(["absent"]), []);
  return paths;
}

export async function runSessionPaths({ harness, paths, R }) {
  let W = await makeWorld(harness, "paths");
  let ran = 0, realized = 0, n = 0; const failures = []; let now = Date.now() - 20 * 3600_000;
  try {
    for (const path_ of paths) {
      if (++n % 3000 === 0) { W.cleanup(); W = await makeWorld(harness, "paths"); }
      const id = `p${String(n).padStart(7, "0")}-0000-4000-8000-000000000000`;
      let rec = fresh(); let ok = true;
      for (const [i, { a: name, to }] of path_.entries()) {
        const a = S_ACTIONS[name];
        if (a.pre && !a.pre(rec)) { ok = false; break; }
        now += 1000;
        if (a.quiet) { now = Math.min(Date.now() - 60_000, now + 3 * 3600_000); }
        else if (a.hide) { const v = W.H.widgetData(W.engine, now).sessions.find((s) => s.id === id); W.H.hideQuiet(W.engine, now); if (v && !v.needsYou && !v.stopped && v.status !== "running" && now - v.lastEventAt > 2 * 3600_000) rec = { ...rec, status: "hidden", ended: now }; }
        else if (a.rename) { W.H.setBuildName(W.engine, id, "x"); }
        else {
          const pl = payloadFor(name, a, rec, { id, cwd: W.proj, now, R, step: n * 100 + i });
          const isDup = !a.bad && dupOf(rec, pl.raw, pl.ts);
          W.deliver(pl.raw, pl.ts);
          const next = spec(rec, a, pl.p, pl.ts, isDup);
          if (!a.bad && !isDup) { next.acceptedBuckets = new Map(rec.acceptedBuckets); next.acceptedBuckets.set(pl.raw, [Math.floor(pl.ts / 5000)]); next.lastRaw = pl.raw; next.lastRawTs = pl.ts; }
          rec = next;
        }
        if (stateOf(rec) !== to) { ok = false; break; } // this path needs details the abstract state doesn't carry
        const row = W.row(id);
        const db = !row ? "absent" : row.status === "completed" && row.status_reason === "Hidden as idle" && row.ended_at != null ? "hidden" : row.status;
        if (db !== stateOf(rec)) { failures.push({ path: path_.map((x) => x.a), step: i, errors: [`status ${db}, expected ${stateOf(rec)}`] }); ok = false; break; }
        if (row && Number(row.event_count) !== rec.events) { failures.push({ path: path_.map((x) => x.a), step: i, errors: [`event_count ${row.event_count}, expected ${rec.events}`] }); ok = false; break; }
      }
      ran++; if (ok) realized++;
      if (now > Date.now() - 4 * 3600_000) now = Date.now() - 20 * 3600_000;
    }
  } finally { W.cleanup(); }
  return { paths: paths.length, ran, realized, failures };
}
