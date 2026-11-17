#!/usr/bin/env node
// Model-based QA for BuildPilot. One command, one seed:
//   npm run test:model -- --seed 7                 everything, seed 7 (several sub-seeds derived from it)
//   npm run test:model -- --seed 7 --layers session,api --seeds 3 --steps 200
//   npm run test:model -- --quick                  a short run (used in CI-style checks)
//   npm run test:model -- --write-model            writes qa/model.json and exits
//   npm run test:model -- --regressions            replays only the saved shrunk sequences
// Layers: session (in-process state machine), concurrency (several processes, one database), api (window server API +
// CLI side builds), ui (headless Chrome on the real window), cli (every command × flag × argument class), plugin
// (slash commands with fake arguments), integration (bp serve), pairwise (criterion c), paths (criterion d).
// Never shows anything on screen: headless Chrome, throwaway HOMEs, OS effects logged (BUILDPILOT_OS_LOG).
// Writes qa/model-coverage.json (the numbers in docs/EXHAUSTIVE_QA_REPORT.md come from it) and, on a failure, a shrunk
// sequence in test/model/regressions/.
import fs from "fs"; import path from "path";
import { buildUnderTest } from "./build.mjs";
import { rng } from "./rng.mjs";
import { recorder } from "./coverage.mjs";
import { shrink, signature } from "./shrink.mjs";
import { runSessionWalk, runConcurrency, sessionPaths, runSessionPaths } from "./session.mjs";
import { runApiWalk, runIntegrationApi, runBuildPaths, buildPaths, runBuildTransitions } from "./api.mjs";
import { runUiWalk, cfgFromRow } from "./ui.mjs";
import { runCliMatrix, runPluginCommands } from "./cli.mjs";
import { machines, modelJson, pairwiseRows, PAGE_CONTROLS } from "./model.mjs";
import { REPO } from "../e2e/env.mjs";

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (k) => argv.includes(`--${k}`);
const quick = flag("quick");
const seed = Number(opt("seed", 1));
const seeds = Number(opt("seeds", quick ? 1 : 3));
const steps = opt("steps") ? Number(opt("steps")) : null;
const ALL = ["session", "concurrency", "api", "transitions", "ui", "cli", "plugin", "integration", "pairwise", "paths"];
const layers = (opt("layers") ?? (quick ? "session,concurrency,api,cli,plugin,integration" : ALL.join(","))).split(",");
const QA = path.join(REPO, "qa"); const REG = path.join(REPO, "test/model/regressions"); fs.mkdirSync(QA, { recursive: true }); fs.mkdirSync(REG, { recursive: true });
const out = (s) => process.stdout.write(s + "\n");

const B = await buildUnderTest();
if (flag("write-model")) { fs.writeFileSync(path.join(QA, "model.json"), JSON.stringify(modelJson(B), null, 2)); out(`wrote qa/model.json`); B.cleanup(); process.exit(0); }
const rec = recorder();
const stats = { seed, seeds, layers, startedAt: new Date().toISOString(), steps: {}, failures: [], shrunk: [], suites: {} };
const addSteps = (k, n) => (stats.steps[k] = (stats.steps[k] ?? 0) + n);
const t0 = Date.now();

/** On a failure: shrink to the smallest sequence that fails the same way, save it as a regression. */
async function onFailure(layer, sub, cfg, res, replay) {
  const f = res.failures[0]; const sig = signature(f);
  out(`  ✗ ${layer} seed ${sub} step ${f.step} ${f.action}: ${f.errors.slice(0, 3).join(" | ")}`);
  const full = res.log.slice(0, f.step + 1);
  const { seq, runs } = await shrink(full, async (c) => { const r = await replay(c); return r.failures.length > 0 && signature(r.failures[0]) === sig; }, { budget: layer === "session" ? 200 : layer === "ui" ? 25 : 50, log: (m) => out(`    ${m}`) });
  const file = path.join(REG, `${layer}-${sub}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ layer, seed: sub, cfg, error: f.errors[0], seq }, null, 1));
  stats.failures.push({ layer, seed: sub, step: f.step, action: f.action, errors: f.errors.slice(0, 3) });
  stats.shrunk.push({ layer, seed: sub, from: full.length, to: seq.length, replays: runs, file: path.relative(REPO, file), seq: seq.map((x) => x.a ?? x) });
  out(`    minimal sequence (${seq.length} of ${full.length} steps, ${runs} replays): ${seq.map((x) => x.a ?? x).join(" → ")}`);
}

const apiCfg = (R) => { const c = { sellable: R.chance(0.8), trialDays: R.pick([0, 0, 2, 14]), count: R.pick([0, 18, 20]), plugin: R.chance(0.25) }; if (R.chance(0.3)) { c.license = B.mint(); c.licenseValid = true; } return c; };
const uiCfg = (R, i) => ({ label: `s${i}`, sellable: R.chance(0.7), trialDays: R.pick([0, 2, 14]), count: R.pick([0, 19, 20]), connected: R.chance(0.8), seeded: R.chance(0.7), plugin: R.chance(0.15) });

async function replayFile(f) {
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  if (j.layer === "session") return runSessionWalk({ harness: B.harness, R: rng(j.seed), seq: j.seq });
  if (j.layer === "api") return runApiWalk({ B, R: rng(j.seed), seq: j.seq, cfg: { ...j.cfg, license: j.cfg.licenseValid ? B.mint() : j.cfg.license } });
  if (j.layer === "ui") return runUiWalk({ B, R: rng(j.seed), seq: j.seq, cfg: j.cfg });
  return { failures: [] };
}

// ---- regressions first: every saved shrunk sequence must pass now ----
const regs = fs.readdirSync(REG).filter((f) => f.endsWith(".json"));
if (regs.length && (flag("regressions") || !flag("no-regressions"))) {
  out(`regressions: ${regs.length} saved sequences`);
  for (const f of regs) { const r = await replayFile(path.join(REG, f)); const ok = !r.failures.length; out(`  ${ok ? "✓" : "✗"} ${f}${ok ? "" : `: ${r.failures[0].errors[0]}`}`); if (!ok) stats.failures.push({ layer: "regression", file: f, errors: r.failures[0].errors }); }
  stats.suites.regressions = { sequences: regs.length, failing: stats.failures.filter((x) => x.layer === "regression").length };
  if (flag("regressions")) { B.cleanup(); process.exit(stats.failures.length ? 1 : 0); }
}

for (let i = 0; i < seeds; i++) {
  const sub = seed * 1000 + i;
  if (layers.includes("session")) {
    const n = steps ?? (quick ? 300 : 1500);
    const r = await runSessionWalk({ harness: B.harness, R: rng(sub), steps: n, sessions: 3, record: rec, covered: rec.covered });
    addSteps("session", r.steps); out(`session   seed ${sub}: ${r.steps} steps ${r.failures.length ? "FAIL" : "ok"}`);
    if (r.failures.length) await onFailure("session", sub, {}, r, (c) => runSessionWalk({ harness: B.harness, R: rng(sub), seq: c }));
  }
  if (layers.includes("concurrency")) {
    const r = await runConcurrency({ harness: B.harness, R: rng(sub), procs: quick ? 4 : 8, sessions: 3, events: quick ? 600 : 2000 });
    addSteps("concurrency", r.events); stats.suites.concurrency = { runs: (stats.suites.concurrency?.runs ?? 0) + 1, events: (stats.suites.concurrency?.events ?? 0) + r.events, procs: r.procs };
    out(`concurrency seed ${sub}: ${r.events} events, ${r.procs} processes ${r.errors.length ? `FAIL ${r.errors.slice(0, 3).join(" | ")}` : "ok"}`);
    if (r.errors.length) stats.failures.push({ layer: "concurrency", seed: sub, errors: r.errors.slice(0, 5) });
  }
  if (layers.includes("api")) {
    for (let k = 0; k < (quick ? 1 : 3); k++) {
      const s2 = sub * 10 + k; const R = rng(s2); const cfg = apiCfg(R);
      const r = await runApiWalk({ B, R, steps: steps ?? (quick ? 50 : 140), cfg, record: rec, covered: rec.covered });
      addSteps("api", r.steps); out(`api       seed ${s2}: ${r.steps} steps ${r.failures.length ? "FAIL" : "ok"}  (${JSON.stringify({ ...cfg, license: cfg.license ? "valid" : undefined })})`);
      if (r.failures.length) await onFailure("api", s2, cfg, r, (c) => runApiWalk({ B, R: rng(s2), seq: c, cfg }));
    }
  }
  if (layers.includes("ui")) {
    for (let k = 0; k < 2; k++) {
      const s2 = sub * 10 + k; const R = rng(s2); const cfg = uiCfg(R, s2);
      const r = await runUiWalk({ B, R, steps: steps ?? 110, cfg, record: rec });
      addSteps("ui", r.steps); out(`ui        seed ${s2}: ${r.steps} steps ${r.failures.length ? "FAIL" : "ok"}`);
      if (r.failures.length) await onFailure("ui", s2, cfg, r, (c) => runUiWalk({ B, R: rng(s2), seq: c, cfg }));
    }
  }
}
if (layers.includes("transitions")) {
  const r = await runBuildTransitions({ B, record: rec, only: quick ? ["none", "clean", "unsaved"] : null });
  addSteps("transitions", r.ran); stats.suites.buildTransitions = { ran: r.ran, failures: r.failures.length };
  out(`side-build transitions: ${r.ran} (state, action) pairs tried, ${r.failures.length} failures`);
  for (const f of r.failures) { out(`  ✗ ${f.state} × ${f.action}: ${f.errors[0]}`); stats.failures.push({ layer: "build-transitions", ...f }); }
}
if (layers.includes("cli")) { const r = await runCliMatrix({ B, record: rec }); addSteps("cli", r.cases); stats.suites.cli = { cases: r.cases, failures: r.failures.length }; out(`cli: ${r.cases} cases, ${r.failures.length} failures`); for (const f of r.failures) { out(`  ✗ bp ${f.args.join(" ")}: ${f.errors.join(", ")}`); stats.failures.push({ layer: "cli", ...f }); } }
if (layers.includes("plugin")) { const r = await runPluginCommands({ B, record: rec }); addSteps("plugin", r.cases); stats.suites.plugin = { cases: r.cases, failures: r.failures.length }; out(`plugin: ${r.cases} cases, ${r.failures.length} failures`); for (const f of r.failures) { out(`  ✗ /${f.command} (${f.cls}): ${f.errors.join(", ")}`); stats.failures.push({ layer: "plugin", ...f }); } }
if (layers.includes("integration")) { const r = await runIntegrationApi({ B, record: rec }); addSteps("integration", r.cases); stats.suites.integration = { cases: r.cases, failures: r.failures.length }; out(`integration: ${r.cases} cases, ${r.failures.length} failures`); for (const f of r.failures) { out(`  ✗ ${f.name}: ${f.why ?? f.status}`); stats.failures.push({ layer: "integration", ...f }); } }
if (layers.includes("pairwise")) {
  const { rows, total } = pairwiseRows(rng(seed));
  let ok = 0;
  for (const [i, row] of rows.entries()) {
    const cfg = cfgFromRow(row, B); const s2 = seed * 100 + i;
    const r = await runUiWalk({ B, R: rng(s2), steps: quick ? 4 : 10, cfg, record: rec });
    addSteps("pairwise", r.steps);
    if (r.failures.length) { out(`  ✗ pairwise row ${i} ${JSON.stringify(row)}: ${r.failures[0].errors[0]}`); stats.failures.push({ layer: "pairwise", row, errors: r.failures[0].errors.slice(0, 3), log: r.log.map((x) => x.a) }); } else ok++;
  }
  stats.suites.pairwise = { rows: rows.length, rowsPassed: ok, pairsTotal: total, pairsCovered: total }; // the greedy array covers every pair by construction (checked below)
  const keys = Object.keys(rows[0]); const seen = new Set(); for (const r of rows) for (let a = 0; a < keys.length; a++) for (let b = a + 1; b < keys.length; b++) seen.add(`${keys[a]}=${r[keys[a]]}&${keys[b]}=${r[keys[b]]}`);
  stats.suites.pairwise.pairsCovered = seen.size;
  out(`pairwise: ${rows.length} configurations cover ${seen.size}/${total} value pairs; ${ok}/${rows.length} passed`);
}
if (layers.includes("paths")) {
  // Session: the graph from this run's walks plus (if present) the committed coverage file, so --layers paths alone works.
  let tr = rec.dump().transitions.session ?? {};
  if (!Object.keys(tr).length) { const r = await runSessionWalk({ harness: B.harness, R: rng(seed), steps: 1500, record: rec, covered: rec.covered }); addSteps("session", r.steps); tr = rec.dump().transitions.session; }
  const sp = sessionPaths(tr, quick ? 4 : 9);
  const r1 = await runSessionPaths({ harness: B.harness, paths: sp, R: rng(seed) });
  addSteps("paths", sp.reduce((s, p) => s + p.length, 0));
  stats.suites.sessionPaths = { paths: r1.paths, ran: r1.ran, realized: r1.realized, failures: r1.failures.length };
  out(`session paths: ${r1.paths} simple paths, ${r1.realized} realized exactly, ${r1.failures.length} failures`);
  for (const f of r1.failures.slice(0, 5)) { out(`  ✗ ${f.path.join(" → ")}: ${f.errors[0]}`); stats.failures.push({ layer: "session-paths", ...f }); }
  const bp = buildPaths(); const r2 = await runBuildPaths({ B, paths: quick ? bp.slice(0, 4) : bp, record: rec });
  addSteps("paths", bp.reduce((s, p) => s + p.length, 0));
  stats.suites.buildPaths = { paths: bp.length, ran: quick ? 4 : bp.length, realized: r2.realized, failures: r2.failures.length };
  out(`side-build paths: ${r2.realized}/${quick ? 4 : bp.length} lifecycle paths passed`);
  for (const f of r2.failures) { out(`  ✗ ${f.path.join(" → ")} at step ${f.step}: ${f.errors[0]}`); stats.failures.push({ layer: "build-paths", ...f }); }
}

// ---- coverage per criterion, from this run ----
const cov = rec.dump();
const M = machines(B);
const coverage = {};
for (const [k, m] of Object.entries(M)) {
  const feasible = []; for (const s of m.states) for (const a of m.actions) if (m.feasible(s, a)) feasible.push(`${s}|${a}`);
  const done = feasible.filter((x) => cov.transitions[k]?.[x]);
  const extra = Object.keys(cov.transitions[k] ?? {}).filter((x) => !feasible.includes(x));
  const pairsAll = m.actions.length ** 2; const pairsDone = Object.keys(cov.pairs[k] ?? {}).length;
  coverage[k] = { transitions: { covered: done.length, feasible: feasible.length, missing: feasible.filter((x) => !done.includes(x)) }, pairs: { covered: pairsDone, of: pairsAll }, unmodelled: extra };
}
// The window: (screen, action) pairs offered vs. run, and every control seen at least once.
const page = cov.transitions.page ?? {};
const ranControls = new Set(Object.keys(page).map((k) => k.split("|")[1]).filter((a) => a.startsWith("press:")).map((a) => a.slice(6).split(".")[0]));
coverage.page = { transitions: { covered: Object.keys(page).length }, pairs: { covered: Object.keys(cov.pairs.page ?? {}).length }, controls: { covered: PAGE_CONTROLS.filter((c) => ranControls.has(c)).length, of: PAGE_CONTROLS.length, missing: PAGE_CONTROLS.filter((c) => !ranControls.has(c)) }, screens: [...new Set(Object.keys(page).map((k) => k.split("|")[0]))] };
coverage.fuzz = { inputClasses: Object.keys(cov.misc.fuzz ?? {}).length, cli: Object.keys(cov.misc.cli ?? {}).length, plugin: Object.keys(cov.misc.plugin ?? {}).length, integration: Object.keys(cov.misc.integration ?? {}).length };
stats.coverage = coverage; stats.seconds = Math.round((Date.now() - t0) / 1000); stats.totalSteps = Object.values(stats.steps).reduce((a, b) => a + b, 0);
const file = path.join(QA, flag("quick") ? "model-coverage-quick.json" : "model-coverage.json");
fs.writeFileSync(file, JSON.stringify({ ...stats, raw: cov }, null, 1));
out("\ncoverage (this run):");
for (const [k, c] of Object.entries(coverage)) if (c.transitions?.feasible) out(`  ${k.padEnd(11)} transitions ${c.transitions.covered}/${c.transitions.feasible} · consecutive pairs ${c.pairs.covered}/${c.pairs.of}`);
out(`  page        ${coverage.page.transitions.covered} (screen, action) pairs run · ${coverage.page.controls.covered}/${coverage.page.controls.of} controls pressed · ${coverage.page.pairs.covered} action pairs`);
out(`  fuzz        ${coverage.fuzz.inputClasses} (action, input class) · cli ${coverage.fuzz.cli} · plugin ${coverage.fuzz.plugin} · integration ${coverage.fuzz.integration}`);
out(`\n${stats.totalSteps} steps in ${stats.seconds} s · ${stats.failures.length} failures · written ${path.relative(REPO, file)}`);
B.cleanup();
process.exitCode = stats.failures.length ? 1 : 0;
