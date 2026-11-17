// The app as state machines: states, actions, which (state, action) pairs are possible, and the expected effect
// (expected effects live with the executors: session.mjs `spec`, api.mjs action table + checkServer, ui.mjs checkUi).
// `npm run test:model -- --write-model` writes qa/model.json from this file.
import { S_STATES, S_ACTIONS } from "./session.mjs";
import { apiActions } from "./api.mjs";

export const BUILD_STATES = ["none", "clean", "unsaved", "saved", "merged", "removed", "unsaved+conflict", "saved+conflict", "unsaved+failing", "saved+failing"];
const live = (s) => !["none", "removed"].includes(s);
/** Is `action` possible from build state `s`? (refused ones count: a refused merge is a transition back to itself) */
export function buildFeasible(s, a) {
  if (a === "newBuild" || a === "cli:new") return s === "none";
  if (a === "edit" || a === "makeConflict") return live(s);
  if (a === "breakTests") return live(s) && !s.endsWith("+failing");
  if (a === "commitInBuild") return s.startsWith("unsaved");
  if (a === "fixConflict") return s === "saved+conflict";
  // The CLI takes a build NAME: with no build there is nothing to name (unknown names are in the CLI matrix: bp merge nope).
  if (a === "cli:review" || a === "cli:merge" || a === "cli:done") return live(s);
  return true; // review / merge / force / cli:merge / remove / cli:done: from any state (unknown or removed folders are refused)
}

export const PLAN_STATES = ["free", "free-exhausted", "trial", "trial-ending", "licensed", "not-sellable"];
export const CONN_STATES = ["disconnected", "connected", "plugin", "plugin+hooks"];
export const PREF_STATES = ["white/on", "white/off", "auto/on", "auto/off", "match/on", "match/off"];
export const PROJECT_STATES = ["clean", "dirty"];

/** Factors for pairwise configuration coverage (criterion c). */
export const FACTORS = {
  plan: PLAN_STATES,
  connection: ["disconnected", "connected", "plugin"],
  data: ["empty", "seeded"],
  theme: ["white", "auto", "match"],
  alerts: ["on", "off"],
  viewport: ["desktop", "phone"],
  scheme: ["light", "dark"],
  project: ["git", "no-git"],
};

/** Every control the window can show (data-act values in src/webview/main.ts and the page script). */
export const PAGE_CONTROLS = ["connectAll", "showConnectChanges", "disconnect", "selectProject", "more", "toggleTheme", "toggleAlerts", "upgrade", "enterLicense", "newBuild", "toggleBuild", "renameBuild", "openBuild", "resumeBuild", "startFresh", "toggleErrors", "copyErrors", "dismissRisk", "toggleQuiet", "hideIdle", "openFinder", "whoChanged", "undoFile", "reviewBuild", "mergeBuild", "removeBuild", "build", "sendPrompt", "useInOpen", "copyPrompt", "tip"];
export const PAGE_STATES = ["connect", "sessions", "prompt-written", "finder", "paywall", "dialog:confirm", "dialog:input", "dialog:show", "dialog:pick", "offline", "expired", "server-down", "loading"];

export function machines(B = { mint: () => "", forge: () => "" }) {
  const A = apiActions(B);
  const by = (m) => Object.keys(A).filter((k) => A[k].run && A[k].m === m);
  const infeasibleSession = new Set(["Late:PostToolUse", "OutOfOrder:Stop", "OutOfOrder:UserPromptSubmit", "OutOfOrder:SessionStart", "Duplicate", "RepeatLater", "Quiet3h", "hideIdle", "rename"]);
  return {
    session: { states: S_STATES, actions: Object.keys(S_ACTIONS), feasible: (s, a) => !(s === "absent" && infeasibleSession.has(a)), note: "in-process: real spool reader + ingestor + node:sqlite store, virtual clock; oracle = session.mjs spec()" },
    build: { states: BUILD_STATES, actions: by("build"), feasible: buildFeasible, note: "real bp ui server + git worktrees; +failing only on Pro (tests run before merge)" },
    plan: { states: PLAN_STATES, actions: by("plan"), feasible: (s, a) => !(a === "trialEnds" && !["trial", "trial-ending"].includes(s)), note: "trialEnds = the clock passes the trial's end (only visible while the plan shows the trial)" },
    connection: { states: CONN_STATES, actions: by("connection"), feasible: () => true },
    prefs: { states: PREF_STATES, actions: by("prefs"), feasible: () => true },
    sessionUi: { states: ["absent", "running", "awaiting_approval", "idle", "failed"], actions: by("sessionUi"), feasible: (s, a) => !(a === "undoFile:edited" && s === "absent"), note: "session actions sent to the window server (rename, dismiss, resume, start fresh, who changed, undo file)" },
    project: { states: PROJECT_STATES, actions: by("project"), feasible: (s, a) => !((a === "mainDirty" && s === "dirty") || (a === "mainClean" && s === "clean")) },
  };
}

/** Machine-readable model (qa/model.json). */
export function modelJson(B) {
  const M = machines(B);
  const out = { generated: new Date().toISOString(), machines: {}, page: { states: PAGE_STATES, controls: PAGE_CONTROLS, environment: ["env:reload", "env:reopen", "env:secondTab", "env:throttle", "env:offline", "env:online", "env:serverStop", "env:serverStart", "env:serverRestart", "env:narrow", "env:dark", "bg:claudeEvent", "bg:apiRename", "bg:cliNew", "bg:apiHideIdle", "bg:editBuild"], dialogs: ["dlg:ok", "dlg:cancel", "dlg:esc", "dlg:enter", "dlg:backdrop", "dlg:type", "dlg:pick"], keys: ["key:j", "key:k", "key:g", "key:/", "key:tab", "key:esc", "key:cmdEnter"] }, factors: FACTORS };
  let states = 0, actions = 0, pairs = 0;
  for (const [k, m] of Object.entries(M)) {
    const feas = []; for (const s of m.states) for (const a of m.actions) if (m.feasible(s, a)) feas.push(`${s}|${a}`);
    out.machines[k] = { states: m.states, actions: m.actions, feasibleTransitions: feas.length, infeasible: m.states.flatMap((s) => m.actions.filter((a) => !m.feasible(s, a)).map((a) => `${s}|${a}`)), note: m.note };
    states += m.states.length; actions += m.actions.length; pairs += feas.length;
  }
  out.totals = { machines: Object.keys(M).length, states: states + PAGE_STATES.length, actions: actions + PAGE_CONTROLS.length + out.page.environment.length + out.page.dialogs.length + out.page.keys.length, feasibleTransitions: pairs };
  return out;
}

/** Greedy pairwise covering array over FACTORS (each pair of factor values appears in at least one row). */
export function pairwiseRows(R) {
  const keys = Object.keys(FACTORS);
  const need = new Set();
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) for (const a of FACTORS[keys[i]]) for (const b of FACTORS[keys[j]]) need.add(`${keys[i]}=${a}&${keys[j]}=${b}`);
  const total = need.size; const rows = [];
  const pairsOf = (row) => { const out = []; for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) out.push(`${keys[i]}=${row[keys[i]]}&${keys[j]}=${row[keys[j]]}`); return out; };
  while (need.size) {
    let best = null, bestN = -1;
    for (let c = 0; c < 60; c++) {
      const row = Object.fromEntries(keys.map((k) => [k, R.pick(FACTORS[k])]));
      // seed the row with one uncovered pair so progress is guaranteed
      const [p] = need; const [[k1, v1], [k2, v2]] = p.split("&").map((x) => x.split("=")); row[k1] = v1; row[k2] = v2;
      const n = pairsOf(row).filter((x) => need.has(x)).length;
      if (n > bestN) { best = row; bestN = n; }
    }
    rows.push(best); for (const x of pairsOf(best)) need.delete(x);
  }
  return { rows, total };
}
