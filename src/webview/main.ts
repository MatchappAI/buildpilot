/* BuildPilot sidebar UI. Plain TypeScript + DOM, no framework: small, fast, CSP-safe. */
import type { UiState } from "../core/engine";
import type { BuiltPrompt, GoalSpec } from "../core/prompts";
import type { SessionView } from "../core/supervisor";
import type { Confidence, EvidenceItem, Issue, Recommendation, Requirement, Severity } from "../core/types";

declare function acquireVsCodeApi(): { postMessage(m: unknown): void; getState(): unknown; setState(s: unknown): void };
const vscode = acquireVsCodeApi();

interface Settings {
  beginner: boolean;
  trusted: boolean;
  aiProvider: string;
  aiModel: string;
  apiEnabled: boolean;
  apiAddress: string | null;
  apiAllowLan: boolean;
  notifications: string;
  platform: string;
  home: string;
}

type Tab = "overview" | "sessions" | "supervisor" | "prompts" | "memory" | "connect";
interface ViewState {
  tab: Tab;
  open: Record<string, boolean>;
  goal: string;
  request: string;
  mustNotChange: string;
  acceptance: string;
  planFirst: boolean;
}

const saved = (vscode.getState() as Partial<ViewState> | undefined) ?? {};
const vs: ViewState = { tab: "overview", open: {}, goal: "feature", request: "", mustNotChange: "", acceptance: "", planFirst: true, ...saved };
let S: UiState | null = null;
let settings: Settings | null = null;
let built: BuiltPrompt | null = null;
let promptText = "";
let goals: GoalSpec[] = [];
let cpFiles: Record<string, string[]> = {};
let hasWebhook = false;
const persist = () => vscode.setState(vs);

// ---------- messaging ----------
let seq = 0;
const waiting = new Map<number, (v: unknown) => void>();
function call<T = unknown>(type: string, data: Record<string, unknown> = {}): Promise<T> {
  const id = ++seq;
  return new Promise((resolve) => {
    waiting.set(id, resolve as (v: unknown) => void);
    vscode.postMessage({ type, id, ...data });
  });
}
window.addEventListener("message", (e: MessageEvent) => {
  const m = e.data as { type: string; id?: number; result?: unknown; state?: UiState; settings?: Settings; tab?: Tab };
  if (m.type === "reply" && m.id) {
    waiting.get(m.id)?.(m.result);
    waiting.delete(m.id);
  } else if (m.type === "state") {
    S = m.state!;
    settings = m.settings!;
    render();
  } else if (m.type === "navigate" && m.tab) {
    vs.tab = m.tab;
    persist();
    render();
  }
});

// ---------- helpers ----------
const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const icon = (n: string, cls = "") => `<i class="codicon codicon-${n} ${cls}" aria-hidden="true"></i>`;
function ago(ts: number | null | undefined): string {
  if (!ts) return "never";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
const CONF_LABEL: Record<Confidence, string> = { verified: "Verified", inferred: "Inferred", unverified: "Unverified", failed: "Failed", unknown: "Unknown" };
const conf = (c: Confidence, title = "") => `<span class="conf conf-${c}" title="${esc(title || confHelp(c))}">${CONF_LABEL[c]}</span>`;
function confHelp(c: Confidence): string {
  return {
    verified: "Checked directly (e.g. a command passed, a file exists).",
    inferred: "BuildPilot's best reading of the evidence. Could be wrong.",
    unverified: "Claimed or assumed, but not proven yet.",
    failed: "Checked, and it failed.",
    unknown: "Not enough information to say.",
  }[c];
}
const SEV_ICON: Record<Severity, string> = { blocker: "error", high: "warning", medium: "info", low: "circle-small", info: "circle-small" };
const sevBadge = (s: Severity) => `<span class="sev sev-${s}">${icon(SEV_ICON[s])}${s === "blocker" ? "Blocker" : s === "high" ? "Important" : s === "medium" ? "Worth doing" : "Optional"}</span>`;
const STATUS_LABEL: Record<string, string> = { running: "Working", idle: "Idle", blocked: "Needs input", awaiting_approval: "Needs approval", completed: "Ended", failed: "Failed", unknown: "Unknown" };
const dot = (status: string) => `<span class="dot dot-${status}" aria-hidden="true"></span>`;
const short = (id: string) => (id.startsWith("demo-") ? `DEMO ${id.slice(5, 11)}` : id.slice(0, 8));
const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const rel = (p: string) => (S?.project && p.startsWith(S.project.root) ? p.slice(S.project.root.length + 1) : p);
const beginner = () => settings?.beginner ?? true;

function evidenceList(ev: EvidenceItem[]): string {
  if (!ev.length) return "";
  return `<ul class="evidence">${ev
    .map((e) => `<li><span class="ev-kind ev-${e.kind}" title="${e.kind === "observed" ? "Seen directly" : "Inferred"}">${e.kind === "observed" ? "seen" : "inferred"}</span> ${esc(e.text)}${e.ref ? ` <a href="#" data-open="${esc(e.ref)}" class="ref">${esc(fileName(e.ref))}</a>` : ""}</li>`)
    .join("")}</ul>`;
}
function disclosure(key: string, summary: string, body: string, openDefault = false): string {
  const open = vs.open[key] ?? openDefault;
  return `<details data-key="${esc(key)}" ${open ? "open" : ""}><summary>${summary}</summary><div class="details-body">${body}</div></details>`;
}

// ---------- shell ----------
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "home" },
  { id: "sessions", label: "Sessions", icon: "pulse" },
  { id: "supervisor", label: "Supervisor", icon: "shield" },
  { id: "prompts", label: "Prompts", icon: "sparkle" },
  { id: "memory", label: "Memory", icon: "book" },
  { id: "connect", label: "Connect", icon: "plug" },
];

function render(): void {
  const app = document.getElementById("app")!;
  const scroll = document.querySelector(".content")?.scrollTop ?? 0;
  const focused = document.activeElement as HTMLElement | null;
  const focusId = focused?.id;
  const selStart = (focused as HTMLInputElement | null)?.selectionStart ?? null;
  if (!S) {
    app.innerHTML = `<div class="loading">Starting BuildPilot…</div>`;
    return;
  }
  if (!S.project) {
    app.innerHTML = `<div class="empty">${icon("folder-opened", "big")}<h2>Open a project</h2><p>BuildPilot supervises one project folder at a time. Open a folder in VS Code, or pick one.</p><button class="primary" data-act="selectProject">Choose project folder</button></div>`;
    return bind();
  }
  const live = S.out.sessions.filter((s) => !s.endedAt && S!.generatedAt - s.lastEventAt < 3600_000);
  const waitingN = live.filter((s) => s.displayStatus === "awaiting_approval" || s.displayStatus === "blocked").length;
  const urgent = S.out.issues.filter((i) => i.severity === "blocker" || i.severity === "high").length;
  const badge: Partial<Record<Tab, string>> = {
    sessions: waitingN ? `<span class="badge warn">${waitingN}</span>` : live.length ? `<span class="badge">${live.length}</span>` : "",
    supervisor: urgent ? `<span class="badge err">${urgent}</span>` : "",
  };
  const health = S.out.health;
  app.innerHTML = `
  <header class="top">
    <div class="title-row">
      <button class="project" data-act="selectProject" title="Switch project">${esc(S.facts?.name ?? S.project.name)} ${icon("chevron-down")}</button>
      <span class="spacer"></span>
      ${S.analyzing ? `<span class="muted small">${icon("loading", "spin")} Analyzing</span>` : `<button class="icon-btn" data-act="analyze" title="Re-analyze project" aria-label="Re-analyze project">${icon("refresh")}</button>`}
    </div>
    <div class="meta-row">
      <span class="health health-${health.level}">${dot(health.level === "good" ? "running" : health.level === "blocked" ? "failed" : health.level === "attention" ? "awaiting_approval" : "unknown")}${esc(health.label)}</span>
      <span class="chip" title="Development stage (${S.out.stage.confidence})">${esc(S.out.stage.stage)}</span>
    </div>
    ${S.demo ? `<div class="demo-banner">${icon("beaker")} Showing DEMO sessions. They aren't real. <a href="#" data-act="demoOff">Remove demo</a></div>` : ""}
    ${!settings?.trusted ? `<div class="demo-banner">${icon("shield")} Restricted Mode: BuildPilot can read, but won't run scripts or change files.</div>` : ""}
    <nav class="tabs" role="tablist">${TABS.map((t) => `<button role="tab" aria-selected="${vs.tab === t.id}" class="tab ${vs.tab === t.id ? "active" : ""}" data-tab="${t.id}" title="${t.label}">${icon(t.icon)}<span class="tab-label">${t.label}</span>${badge[t.id] ?? ""}</button>`).join("")}</nav>
  </header>
  <main class="content" role="tabpanel">${S.errors.map((e) => `<div class="error-box">${icon("error")} ${esc(e)}</div>`).join("")}${renderTab()}</main>`;
  bind();
  const c = document.querySelector(".content");
  if (c) c.scrollTop = scroll;
  if (focusId) {
    const el = document.getElementById(focusId) as HTMLInputElement | null;
    if (el) {
      el.focus();
      if (selStart !== null && "setSelectionRange" in el) try { el.setSelectionRange(selStart, selStart); } catch { /* not a text input */ }
    }
  }
}

function renderTab(): string {
  switch (vs.tab) {
    case "overview": return overview();
    case "sessions": return sessionsTab();
    case "supervisor": return supervisorTab();
    case "prompts": return promptsTab();
    case "memory": return memoryTab();
    case "connect": return connectTab();
  }
}

// ---------- Overview ----------
function actionButton(r: Recommendation, primary = true): string {
  const a = r.action;
  const cls = primary ? "primary" : "secondary";
  if (!a) return "";
  if (a.kind === "install_hooks") return `<button class="${cls}" data-act="installHooks">Connect</button>`;
  if (a.kind === "checkpoint") return `<button class="${cls}" data-act="checkpoint">${icon("save")} Save checkpoint</button>`;
  if (a.kind === "run_script") return `<button class="${cls}" data-act="runScript" data-script="${esc(a.script)}" ${S?.runningScript ? "disabled" : ""}>${icon("play")} ${a.script === "install" ? "Install" : `Run ${esc(a.script)}`}</button>`;
  if (a.kind === "prompt") return `<button class="${cls}" data-act="promptFor" data-goal="${esc(a.goal)}" data-request="${esc(a.request)}">${icon("sparkle")} Write the prompt</button>`;
  if (a.kind === "open_file") return `<button class="${cls}" data-open="${esc(a.path)}">Open</button>`;
  return "";
}

function nextCard(): string {
  const n = S!.out.next;
  if (!n) return `<section class="next good">${icon("pass-filled")}<div><div class="eyebrow">Next step</div><div class="next-title">Nothing urgent. Keep building.</div><p class="muted">Tell Prompt Studio what you want next.</p><button class="secondary" data-tab="prompts">Open Prompt Studio</button></div></section>`;
  return `<section class="next sev-border-${n.severity}" aria-label="Recommended next step">
    <div class="eyebrow">Next step ${sevBadge(n.severity)}</div>
    <div class="next-title">${esc(n.title)}</div>
    <p>${esc(n.why)}</p>
    <div class="actions">${actionButton(n)}<button class="link" data-act="dismiss" data-key="${esc(n.key)}" title="Hide for 24 hours">Not now</button></div>
    ${disclosure(`ev:${n.key}`, "Why BuildPilot thinks so", evidenceList(n.evidence))}
  </section>`;
}

function overview(): string {
  const st = S!;
  const f = st.facts;
  const live = st.out.sessions.filter((s) => !s.endedAt && st.generatedAt - s.lastEventAt < 3600_000);
  const running = live.filter((s) => s.displayStatus === "running").length;
  const waitingN = live.filter((s) => s.displayStatus === "awaiting_approval" || s.displayStatus === "blocked").length;
  const top = st.out.issues.filter((i) => i.severity === "blocker" || i.severity === "high");
  const happening = !st.hooks.installed
    ? `Not connected to Claude Code yet. <a href="#" data-act="installHooks">Connect</a>`
    : live.length === 0
      ? "No active Claude Code sessions in this project."
      : `${running} session${running === 1 ? "" : "s"} working${waitingN ? `, <b>${waitingN} waiting for you</b>` : ""}. <a href="#" data-tab="sessions">See sessions</a>`;
  const wrong = top.length === 0 ? "Nothing urgent found." : `${top.length} important issue${top.length === 1 ? "" : "s"}: ${esc(top[0]!.title)}${top.length > 1 ? ` <a href="#" data-tab="supervisor">+${top.length - 1} more</a>` : ""}`;
  const reqs = st.requirements.filter((r) => r.status !== "dropped");
  const implemented = reqs.filter((r) => r.status === "done" && r.evidence === "verified");
  const partial = reqs.filter((r) => r.status === "in_progress" || (r.status === "done" && r.evidence !== "verified"));
  const missing = reqs.filter((r) => r.status === "todo");
  const lastTest = st.testRuns.find((t) => /test|vitest|jest|pytest/.test(t.command));
  return `
  ${nextCard()}
  <section class="qa">
    <div class="qa-row"><span class="qa-q">What's happening?</span><span>${happening}</span></div>
    <div class="qa-row"><span class="qa-q">Anything wrong?</span><span>${wrong}</span></div>
  </section>
  <section>
    <h3>Project</h3>
    <dl class="facts">
      <dt>What it is</dt><dd>${f?.description ? `${esc(f.description)} <span class="muted small">(from ${esc(f.descriptionSource)})</span>` : st.notes.goal ? esc(st.notes.goal) : `<span class="muted">Unknown.</span> <a href="#" data-tab="memory">Describe your goal</a>`}</dd>
      <dt>Built with</dt><dd>${f ? esc([...f.languages, ...f.frameworks].join(", ") || "Not detected") : "…"}</dd>
      <dt>Stage</dt><dd>${esc(st.out.stage.stage)} ${conf(st.out.stage.confidence)}${disclosure("stage-ev", "evidence", evidenceList(st.out.stage.evidence))}</dd>
      <dt>Progress</dt><dd>${st.out.progress.total ? `<div class="bar" role="progressbar" aria-valuenow="${st.out.progress.done}" aria-valuemax="${st.out.progress.total}"><span style="width:${Math.round((st.out.progress.done / st.out.progress.total) * 100)}%"></span></div>` : ""}${esc(st.out.progress.label)}</dd>
      <dt>Tests</dt><dd>${lastTest ? `${lastTest.passed ? conf("verified", "Passed when BuildPilot ran it") + " passing" : conf("failed") + " failing"} · ${ago(lastTest.startedAt)}` : `${conf("unknown")} not run yet${f?.scripts.test ? ` · <a href="#" data-act="runScript" data-script="test">Run tests</a>` : ""}`}</dd>
      <dt>Git</dt><dd>${st.changes ? `${esc(st.changes.branch ?? "detached")} · ${st.changes.unstaged.length + st.changes.untracked.length + st.changes.staged.length} uncommitted` : f?.isGit === false ? `${conf("failed")} not using Git` : "…"}</dd>
    </dl>
  </section>
  <section>
    <h3>Features <span class="muted small">vs. your requirements</span></h3>
    ${reqs.length === 0
      ? `<p class="muted">No requirements yet, so BuildPilot can't tell what's built vs. missing. ${f?.checklistItems.length ? `<a href="#" data-act="importChecklist">Import ${f.checklistItems.length} checklist items from your docs</a> or ` : ""}<a href="#" data-tab="memory">add them</a>.</p>`
      : `${featureGroup("Done & verified", implemented, "verified")}${featureGroup("Partly done / unproven", partial, "unverified")}${featureGroup("Not started", missing, "unknown")}`}
  </section>
  ${st.resolved.length ? `<section><h3>Recently resolved</h3><ul class="plain">${st.resolved.map((r) => `<li>${icon("check", "ok")} ${esc(r.title)} <span class="muted small">${ago(r.resolvedAt)}: condition no longer observed</span></li>`).join("")}</ul></section>` : ""}
  <section>
    <h3>Recent work</h3>
    ${st.commits.length ? `<ul class="plain">${st.commits.slice(0, 5).map((c) => `<li><span class="muted small">${ago(c.ts)}</span> ${esc(c.subject)}</li>`).join("")}</ul>` : `<p class="muted">No commits yet.</p>`}
  </section>
  ${setupCard()}`;
}

function featureGroup(label: string, items: Requirement[], c: Confidence): string {
  if (!items.length) return "";
  return `<div class="fgroup"><div class="fgroup-h">${conf(c)} ${esc(label)} <span class="muted">(${items.length})</span></div><ul class="plain">${items.slice(0, 8).map((r) => `<li>${esc(r.title)}</li>`).join("")}${items.length > 8 ? `<li class="muted">+${items.length - 8} more</li>` : ""}</ul></div>`;
}

function setupCard(): string {
  const st = S!;
  const steps = [
    { done: !!st.integration.claudeInstalled, label: "Claude Code installed", hint: st.integration.claudeInstalled === null ? "checking…" : st.integration.claudeVersion ?? "Install from claude.com/claude-code" },
    { done: st.hooks.installed, label: "BuildPilot connected to Claude Code", hint: st.hooks.installed ? "Live sessions will appear automatically" : "", act: st.hooks.installed ? "" : `<button class="secondary small" data-act="installHooks">Connect</button>` },
    { done: !!st.integration.gitAvailable && !!st.facts?.isGit, label: "Project uses Git", hint: st.facts?.isGit ? "" : "Needed for checkpoints and rollback" },
  ];
  if (steps.every((s) => s.done)) return "";
  return `<section><h3>Setup</h3><ul class="steps">${steps.map((s) => `<li>${icon(s.done ? "pass-filled" : "circle-large-outline", s.done ? "ok" : "muted")} <span>${esc(s.label)}${s.hint ? ` <span class="muted small">· ${esc(s.hint)}</span>` : ""}</span> ${s.act ?? ""}</li>`).join("")}</ul></section>`;
}

// ---------- Sessions ----------
function sessionsTab(): string {
  const st = S!;
  if (!st.hooks.installed && st.out.sessions.length === 0) {
    return `<div class="empty">${icon("plug", "big")}<h2>Connect to Claude Code</h2><p>BuildPilot adds small background hooks to Claude Code so it can see what each session is doing. Nothing leaves your computer. Your settings are backed up and it can be undone.</p><button class="primary" data-act="installHooks">Connect</button><p class="muted small">Or <a href="#" data-act="demoOn">try it with demo data</a> first.</p></div>`;
  }
  if (st.out.sessions.length === 0) {
    return `<div class="empty">${icon("terminal", "big")}<h2>No sessions yet</h2><p>Start Claude Code in this project (run <code>claude</code> in a terminal). It'll appear here within a second.</p>${st.integration.otherProjectSessions ? `<p class="muted small">${st.integration.otherProjectSessions} active session(s) are running in other folders.</p>` : ""}<p class="muted small">Already running? Sessions started before connecting need a restart.</p><button class="secondary" data-act="promptFor" data-goal="feature" data-request="">${icon("sparkle")} Write a first prompt</button></div>`;
  }
  const active = st.out.sessions.filter((s) => !s.endedAt && st.generatedAt - s.lastEventAt < 12 * 3600_000);
  const past = st.out.sessions.filter((s) => !active.includes(s));
  return `
    ${active.length ? `<h3>Active <span class="muted small">(${active.length})</span></h3>${active.map(sessionCard).join("")}` : `<p class="muted">No active sessions.</p>`}
    ${past.length ? disclosure("past-sessions", `Earlier sessions (${past.length})`, past.map(sessionCard).join("")) : ""}
    ${st.integration.otherProjectSessions ? `<p class="muted small">${st.integration.otherProjectSessions} active session(s) in other folders aren't shown.</p>` : ""}
    <div class="actions"><button class="secondary" data-act="copyHandoff">${icon("copy")} Copy handoff for a new session</button></div>
    <p class="muted small">Statuses come from Claude Code hook events. BuildPilot never guesses what a terminal is doing. If it hasn't heard anything in 10 minutes, it says "Unknown".</p>`;
}

function sessionCard(s: SessionView): string {
  const u = S!.usage[s.id];
  const tokens = u && u.source === "transcript"
    ? `${u.lastTurnInputTokens?.toLocaleString() ?? "?"} tokens in context (estimate) · ${u.totalOutputTokens?.toLocaleString() ?? "?"} written · ${u.assistantTurns} turns`
    : "Unknown (no local transcript data)";
  const timeline = s.recent.map((e) => `<li class="${e.isError ? "err" : ""}"><span class="muted small t">${new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span> ${esc(e.summary)}${e.filePath ? ` <a href="#" data-open="${esc(e.filePath)}" class="ref">open</a>` : ""}${e.isError && e.errorText ? `<div class="errtext">${esc(e.errorText.split("\n").slice(0, 3).join(" "))}</div>` : ""}</li>`).join("");
  return `<article class="session ${s.displayStatus}" aria-label="Session ${esc(short(s.id))}">
    <div class="s-head">${dot(s.displayStatus)}<b>${STATUS_LABEL[s.displayStatus] ?? s.displayStatus}</b><span class="muted small mono">${esc(short(s.id))}</span><span class="spacer"></span><span class="muted small">${ago(s.lastEventAt)}</span></div>
    ${s.currentTask ? `<div class="s-task" title="Last prompt you gave it">“${esc(s.currentTask)}”</div>` : `<div class="s-task muted">Task unknown (no prompt seen yet)</div>`}
    <div class="s-reason">${esc(s.displayReason)}</div>
    ${s.intervention ? `<div class="s-int">${icon("arrow-right")} ${esc(s.intervention)}</div>` : ""}
    ${s.overlapsWith.length ? `<div class="s-int warn">${icon("warning")} Editing the same files as ${s.overlapsWith.map(short).join(", ")}</div>` : ""}
    ${disclosure(`sess:${s.id}`, `Details · ${s.eventCount} events${s.errorCount ? ` · <span class="errc">${s.errorCount} errors</span>` : ""}`, `
      <dl class="facts small">
        <dt>Folder</dt><dd class="mono">${esc(rel(s.cwd) || ".")}</dd>
        <dt>Model</dt><dd>${esc(u?.model ?? s.model ?? "Unknown")}</dd>
        <dt>Usage</dt><dd>${esc(tokens)}</dd>
        <dt>Cost</dt><dd>Unknown <span class="muted">(subscriptions don't expose per-session cost)</span></dd>
        <dt>Started</dt><dd>${new Date(s.startedAt).toLocaleString()}</dd>
        ${s.permissionMode ? `<dt>Permissions</dt><dd>${esc(s.permissionMode)}</dd>` : ""}
      </dl>
      ${s.editedFiles.length ? `<div class="sub">Changed files</div><ul class="plain files">${s.editedFiles.map((f) => `<li><a href="#" data-open="${esc(f)}">${esc(rel(f))}</a></li>`).join("")}</ul>` : ""}
      <div class="sub">Timeline (newest first)</div><ul class="timeline">${timeline || "<li class='muted'>No events</li>"}</ul>`)}
  </article>`;
}

// ---------- Supervisor ----------
function issueRow(i: Issue): string {
  return `<li class="issue">${sevBadge(i.severity)}<div class="issue-body"><div class="issue-title">${esc(i.title)}</div>${beginner() ? `<div class="plain-expl">${esc(i.plain)}</div>` : ""}${disclosure(`iss:${i.key}`, "Evidence", (beginner() ? "" : `<p class="plain-expl">${esc(i.plain)}</p>`) + evidenceList(i.evidence))}</div></li>`;
}

function supervisorTab(): string {
  const st = S!;
  const recs = st.out.recommendations;
  const f = st.facts;
  return `
  <section>
    <h3>Issues <span class="muted small">${st.out.issues.length ? `(${st.out.issues.length})` : ""}</span></h3>
    ${st.out.issues.length ? `<ul class="issues">${st.out.issues.map(issueRow).join("")}</ul>` : `<p class="muted">${icon("pass", "ok")} No issues found in what BuildPilot can check. That doesn't prove there are none.</p>`}
  </section>
  <section>
    <h3>Recommendations</h3>
    ${recs.length ? `<ol class="recs">${recs.slice(0, 8).map((r) => `<li><div class="rec-title">${esc(r.title)} ${sevBadge(r.severity)}</div><div class="muted">${esc(r.why)}</div><div class="actions">${actionButton(r, false)}<button class="link" data-act="dismiss" data-key="${esc(r.key)}">Not now</button></div></li>`).join("")}</ol>` : `<p class="muted">Nothing to recommend right now.</p>`}
  </section>
  <section>
    <h3>Checks</h3>
    <div class="actions wrap">
      ${f?.scripts.test ? `<button class="secondary" data-act="runScript" data-script="test" ${st.runningScript ? "disabled" : ""}>${icon("beaker")} Run tests</button>` : ""}
      ${f?.scripts.build ? `<button class="secondary" data-act="runScript" data-script="build" ${st.runningScript ? "disabled" : ""}>${icon("package")} Build</button>` : ""}
      ${f?.scripts.lint ? `<button class="secondary" data-act="runScript" data-script="lint" ${st.runningScript ? "disabled" : ""}>${icon("checklist")} Lint</button>` : ""}
      ${f?.scripts.typecheck ? `<button class="secondary" data-act="runScript" data-script="typecheck" ${st.runningScript ? "disabled" : ""}>${icon("symbol-type-parameter")} Typecheck</button>` : ""}
      <button class="secondary" data-act="analyze">${icon("shield")} Re-scan</button>
    </div>
    ${st.runningScript ? `<p class="muted">${icon("loading", "spin")} Running <code>${esc(st.runningScript)}</code>…</p>` : ""}
    ${st.testRuns.length ? disclosure("runs", `Recent runs (${st.testRuns.length})`, `<ul class="plain">${st.testRuns.slice(0, 8).map((t) => `<li>${t.passed ? icon("pass", "ok") : icon("error", "bad")} <code>${esc(t.command)}</code> <span class="muted small">${ago(t.startedAt)} · ${(t.durationMs / 1000).toFixed(1)}s</span>${disclosure(`run:${t.id}`, "output", `<pre>${esc(t.outputTail)}</pre>`)}</li>`).join("")}</ul>`) : ""}
  </section>
  <section>
    <h3>Ready to ship?</h3>
    <ul class="ready">${st.out.readiness.map((r) => `<li>${conf(r.status)} <span>${esc(r.label)}</span><div class="muted small">${esc(r.detail)}</div></li>`).join("")}</ul>
    <p class="muted small">Only items marked Verified were checked. BuildPilot never calls a product "production-ready" from opinion.</p>
  </section>
  <section>
    <h3>Environment</h3>
    ${st.doctor.length ? `<ul class="ready">${st.doctor.map((d) => `<li>${conf(d.status === "ok" ? "verified" : d.status === "fail" ? "failed" : d.status === "warn" ? "unverified" : "unknown")} <span>${esc(d.label)}</span><div class="muted small">${esc(d.detail)}</div></li>`).join("")}</ul>` : `<p class="muted">No checks apply to this project type yet.</p>`}
  </section>
  <section>
    <h3>Safe changes</h3>
    <p class="muted small">A checkpoint saves every file without touching your branch or staging. Restore individual files later if a change goes wrong.</p>
    <div class="actions"><button class="secondary" data-act="checkpoint" ${f?.isGit ? "" : "disabled"}>${icon("save")} Save checkpoint</button></div>
    ${st.checkpoints.length ? `<ul class="plain">${st.checkpoints.slice(0, 6).map((c) => `<li>${icon("history")} ${esc(c.label)} <span class="muted small">${ago(c.ts)} · ${c.sha.slice(0, 8)}</span> <a href="#" data-act="cpDiff" data-sha="${c.sha}">changed since</a>${cpFiles[c.sha] ? cpDiffList(c.sha) : ""}</li>`).join("")}</ul>` : ""}
  </section>`;
}

function cpDiffList(sha: string): string {
  const files = cpFiles[sha]!;
  if (!files.length) return `<div class="muted small">No changes since this checkpoint.</div>`;
  return `<div class="cp-files"><ul class="plain files">${files.slice(0, 40).map((f) => `<li><label><input type="checkbox" class="cpf" data-sha="${sha}" value="${esc(f)}"> ${esc(f)}</label></li>`).join("")}</ul><button class="secondary small" data-act="rollback" data-sha="${sha}">${icon("discard")} Restore selected files</button></div>`;
}

// ---------- Prompt Studio ----------
function promptsTab(): string {
  const g = goals.find((x) => x.id === vs.goal);
  return `
  <section>
    <h3>Prompt Studio</h3>
    <p class="muted small">Describe what you want. BuildPilot turns it into a structured Claude Code prompt with your project's context, guardrails, acceptance criteria and verification steps.</p>
    <div class="goals" role="radiogroup" aria-label="Goal">${goals.map((x) => `<button role="radio" aria-checked="${x.id === vs.goal}" class="goal ${x.id === vs.goal ? "on" : ""}" data-goal-pick="${x.id}" title="${esc(x.plain)}">${esc(x.label)}</button>`).join("")}</div>
    ${g ? `<p class="muted small">${esc(g.plain)}</p>` : ""}
    <label class="lbl" for="req">What do you want?</label>
    <textarea id="req" rows="3" placeholder="${esc(g?.hint ?? "")}">${esc(vs.request)}</textarea>
    ${g?.questions.length ? `<div class="muted small hint">Helpful to include: ${g.questions.map(esc).join(" · ")}</div>` : ""}
    ${disclosure("prompt-more", "More options", `
      <label class="lbl" for="must">Must not change (optional)</label>
      <input id="must" type="text" value="${esc(vs.mustNotChange)}" placeholder="e.g. the database schema, the login page design">
      <label class="lbl" for="acc">Extra "done when…" criteria, one per line (optional)</label>
      <textarea id="acc" rows="2">${esc(vs.acceptance)}</textarea>
      <label class="check"><input type="checkbox" id="planFirst" ${vs.planFirst ? "checked" : ""}> Ask Claude for a plan before it edits</label>`)}
    <div class="actions"><button class="primary" data-act="build">${icon("sparkle")} Build prompt</button></div>
  </section>
  ${built ? `
  <section class="built">
    ${built.missingInfo.length ? `<div class="note warn">${icon("question")} <div><b>Worth adding</b><ul>${built.missingInfo.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div></div>` : ""}
    ${built.assumptions.length ? `<div class="note">${icon("info")} <div><b>Assumptions made</b><ul>${built.assumptions.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div></div>` : ""}
    <div class="muted small">Model: ${esc(built.suggestedModel)} · ${built.verification.length ? `Verifies with: ${built.verification.join(", ")}` : "No check commands found"} · ${promptText.length.toLocaleString()} characters</div>
    <label class="lbl" for="ptext">Your prompt (edit freely)</label>
    <textarea id="ptext" class="mono" rows="16">${esc(promptText)}</textarea>
    <div class="actions wrap">
      <button class="primary" data-act="copyPrompt">${icon("copy")} Copy</button>
      <button class="secondary" data-act="sendPrompt" ${settings?.trusted ? "" : "disabled"} title="Opens a terminal and starts Claude Code with this prompt">${icon("terminal")} Start in Claude Code</button>
      <button class="secondary" data-act="refine" title="${settings?.aiProvider === "none" ? "Needs an AI provider (optional)" : "Uses " + esc(settings?.aiProvider)}">${icon("wand")} Refine with AI</button>
    </div>
    <p class="muted small">"Start in Claude Code" opens a new terminal running <code>claude</code> with this prompt, after you confirm. To use an existing session, copy and paste instead.</p>
  </section>` : ""}`;
}

// ---------- Memory ----------
function memoryTab(): string {
  const st = S!;
  const statusOpts = (r: Requirement) => (["todo", "in_progress", "done", "dropped"] as const).map((s) => `<option value="${s}" ${r.status === s ? "selected" : ""}>${{ todo: "Not started", in_progress: "In progress", done: "Done", dropped: "Dropped" }[s]}</option>`).join("");
  return `
  <section>
    <h3>Goal</h3>
    <textarea id="goal" rows="2" placeholder="What are you building, for whom, and what does success look like?">${esc(st.notes.goal)}</textarea>
    <div class="actions"><button class="secondary small" data-act="saveNote" data-key="goal" data-src="goal">Save</button></div>
  </section>
  <section>
    <h3>Requirements</h3>
    <p class="muted small">Progress is measured only against these. "Done" counts as verified once tests pass after you mark it.</p>
    ${st.requirements.length ? `<ul class="reqs">${st.requirements.map((r) => `<li>
      <div class="req-top"><select data-req-status="${r.id}" aria-label="Status for ${esc(r.title)}">${statusOpts(r)}</select><span class="req-title">${esc(r.title)}</span>${r.status === "done" ? conf(r.evidence, r.evidenceNote) : ""}<span class="spacer"></span><button class="icon-btn" data-act="delReq" data-id="${r.id}" aria-label="Delete requirement">${icon("trash")}</button></div>
      <div class="muted small">${r.acceptance ? `Done when: ${esc(r.acceptance)}` : `<span class="warn-text">No acceptance criteria.</span> <a href="#" data-act="editAcc" data-id="${r.id}">Add</a>`}</div>
    </li>`).join("")}</ul>` : ""}
    <input id="newReq" type="text" placeholder="e.g. Users can pay with a card">
    <input id="newAcc" type="text" placeholder="Done when… e.g. a test payment succeeds and a receipt is emailed">
    <div class="actions"><button class="secondary small" data-act="addReq">Add requirement</button>${st.facts?.checklistItems.length ? `<button class="link" data-act="importChecklist">Import ${st.facts.checklistItems.length} from docs</button>` : ""}</div>
  </section>
  <section>
    <h3>Decisions</h3>
    ${st.decisions.length ? `<ul class="plain">${st.decisions.map((d) => `<li><b>${esc(d.title)}</b>${d.detail ? `: ${esc(d.detail)}` : ""} <button class="icon-btn" data-act="delDec" data-id="${d.id}" aria-label="Delete decision">${icon("close")}</button></li>`).join("")}</ul>` : `<p class="muted small">Record choices (e.g. "Use Supabase for auth") so new sessions don't undo them.</p>`}
    <input id="newDec" type="text" placeholder="Decision"><input id="newDecD" type="text" placeholder="Why / detail (optional)">
    <div class="actions"><button class="secondary small" data-act="addDec">Add decision</button></div>
  </section>
  <section>
    <h3>Preferences</h3>
    <textarea id="prefs" rows="2" placeholder="e.g. Keep the UI minimal. Use TypeScript. Explain things simply.">${esc(st.notes.preferences)}</textarea>
    <div class="actions"><button class="secondary small" data-act="saveNote" data-key="preferences" data-src="prefs">Save</button></div>
  </section>
  <section>
    <h3>Session handoff</h3>
    <p class="muted small">A compact summary of goal, requirements, state, what was tried, and the next step, to start a new Claude Code session without losing context.</p>
    <div class="actions wrap"><button class="secondary" data-act="copyHandoff">${icon("copy")} Copy handoff</button><button class="secondary" data-act="handoffPrompt">${icon("sparkle")} Handoff prompt</button><button class="link" data-act="saveHandoff">Save to .buildpilot/HANDOFF.md</button></div>
    <div class="actions"><button class="link" data-act="claudeMd">${st.facts?.hasClaudeMd ? "Draft CLAUDE.md additions" : "Draft a CLAUDE.md"}</button></div>
  </section>
  <section>
    <h3>Your data</h3>
    <p class="muted small">Stored only on this computer in <code>${esc(settings?.home ?? "~/.buildpilot")}</code>.</p>
    <div class="actions wrap"><button class="link danger" data-act="deleteProjectData">Delete this project's data</button><button class="link danger" data-act="deleteAllData">Delete all data</button></div>
  </section>`;
}

// ---------- Connect ----------
function connectTab(): string {
  const st = S!;
  const s = settings!;
  return `
  <section>
    <h3>Claude Code</h3>
    <ul class="steps">
      <li>${icon(st.integration.claudeInstalled ? "pass-filled" : "circle-large-outline", st.integration.claudeInstalled ? "ok" : "muted")} <span>${st.integration.claudeInstalled ? `Installed: ${esc(st.integration.claudeVersion)}` : st.integration.claudeInstalled === null ? "Checking…" : "Not found on PATH"}</span></li>
      <li>${icon(st.hooks.installed ? "pass-filled" : "circle-large-outline", st.hooks.installed ? "ok" : "muted")} <span>${st.hooks.installed ? "Connected" : st.hooks.settingsError ? `Settings file problem: ${esc(st.hooks.settingsError)}` : "Not connected"}<div class="muted small mono">${esc(st.hooks.settingsPath)}</div></span></li>
      <li>${icon("database", "muted")} <span>${st.integration.spool.accepted} events received this run${st.integration.spool.rejected ? `, ${st.integration.spool.rejected} malformed ignored` : ""}${st.integration.spool.lastEventAt ? ` · last ${ago(st.integration.spool.lastEventAt)}` : ""}</span></li>
    </ul>
    <div class="actions wrap">${st.hooks.installed ? `<button class="link" data-act="uninstallHooks">Disconnect</button>` : `<button class="primary" data-act="installHooks">Connect</button>`}${st.demo ? `<button class="link" data-act="demoOff">Remove demo data</button>` : `<button class="link" data-act="demoOn">Load demo data</button>`}</div>
  </section>
  <section>
    <h3>Phone, glasses &amp; other devices</h3>
    <p class="muted small">Get alerts where you are, like "Claude needs your approval" or "Tests failing". Send them to <b>ntfy</b> (free phone push; smart glasses paired to your phone can read phone notifications aloud), <b>Slack</b>, <b>Discord</b>, or any webhook. Only short alerts and the project name are sent, never code.</p>
    <div class="actions wrap"><button class="secondary" data-act="setWebhook">${icon("bell")} ${hasWebhook ? "Change notification URL" : "Set up notifications"}</button>${hasWebhook ? `<button class="link" data-act="testWebhook">Send test</button>` : ""}</div>
  </section>
  <section>
    <h3>Integration API</h3>
    <p class="muted small">Lets your own tools ask BuildPilot what's happening: iOS Shortcuts / Siri, Raycast, Stream Deck, a companion app for smart glasses, or a bot. Read-only plus prompt generation. It can't run commands or change files. Requires a secret token.</p>
    <label class="check"><input type="checkbox" id="apiToggle" ${s.apiEnabled ? "checked" : ""}> Enable on ${s.apiAllowLan ? "your local network" : "this computer only"}</label>
    ${s.apiEnabled && s.apiAddress ? `<div class="mono small api">${esc(s.apiAddress)}/v1/brief?format=text<br>${esc(s.apiAddress)}/v1/status · /v1/sessions · /v1/next<br>POST ${esc(s.apiAddress)}/v1/prompt {"goal","request"}</div>
      <div class="actions wrap"><button class="secondary small" data-act="copyApiToken">${icon("key")} Copy token</button><button class="link" data-act="rotateApiToken">New token</button><button class="link" data-act="settings">Port / network settings</button></div>` : ""}
  </section>
  <section>
    <h3>AI refinement <span class="muted small">(optional)</span></h3>
    <p class="muted small">BuildPilot works fully without AI. Optionally refine prompts with your own Anthropic API key or a local Ollama model. Nothing is sent without your OK each time.</p>
    <div class="muted small">Provider: <b>${esc(s.aiProvider)}</b>${s.aiModel ? ` · ${esc(s.aiModel)}` : ""}</div>
    <div class="actions"><button class="link" data-act="settings">Change in Settings</button></div>
  </section>
  <section>
    <h3>Experience</h3>
    <label class="check"><input type="checkbox" id="beginner" ${s.beginner ? "checked" : ""}> Beginner explanations (plain-English "why it matters")</label>
    <div class="muted small">Pop-up alerts: ${esc(s.notifications)} · <a href="#" data-act="settings">change</a></div>
  </section>`;
}

// ---------- events ----------
function bind(): void {
  document.querySelectorAll<HTMLElement>("[data-tab]").forEach((el) =>
    el.addEventListener("click", (e) => {
      e.preventDefault();
      vs.tab = el.dataset.tab as Tab;
      persist();
      if (vs.tab === "connect") void call<boolean>("hasWebhook").then((v) => { hasWebhook = v; render(); });
      render();
      (document.querySelector(".content") as HTMLElement | null)?.scrollTo(0, 0);
    }),
  );
  document.querySelectorAll<HTMLDetailsElement>("details[data-key]").forEach((d) => d.addEventListener("toggle", () => { vs.open[d.dataset.key!] = d.open; persist(); }));
  document.querySelectorAll<HTMLElement>("[data-open]").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); void call("openFile", { path: el.dataset.open }); }));
  document.querySelectorAll<HTMLElement>("[data-goal-pick]").forEach((el) => el.addEventListener("click", () => { vs.goal = el.dataset.goalPick!; persist(); render(); }));
  const bindInput = (id: string, key: keyof ViewState) => document.getElementById(id)?.addEventListener("input", (e) => { (vs as unknown as Record<string, unknown>)[key] = (e.target as HTMLInputElement).value; persist(); });
  bindInput("req", "request");
  bindInput("must", "mustNotChange");
  bindInput("acc", "acceptance");
  document.getElementById("planFirst")?.addEventListener("change", (e) => { vs.planFirst = (e.target as HTMLInputElement).checked; persist(); });
  document.getElementById("ptext")?.addEventListener("input", (e) => { promptText = (e.target as HTMLTextAreaElement).value; });
  document.getElementById("apiToggle")?.addEventListener("change", (e) => void call("apiToggle", { value: (e.target as HTMLInputElement).checked }));
  document.getElementById("beginner")?.addEventListener("change", (e) => void call("setBeginner", { value: (e.target as HTMLInputElement).checked }));
  document.querySelectorAll<HTMLSelectElement>("[data-req-status]").forEach((el) => el.addEventListener("change", () => void call("updateRequirement", { id: el.dataset.reqStatus, patch: { status: el.value } })));
  document.getElementById("req")?.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter" && ((e as KeyboardEvent).metaKey || (e as KeyboardEvent).ctrlKey)) void buildNow(); });
  document.getElementById("newAcc")?.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") void addReq(); });
  document.querySelectorAll<HTMLElement>("[data-act]").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); void act(el); }));
}

const val = (id: string) => ((document.getElementById(id) as HTMLInputElement | null)?.value ?? "").trim();

async function buildNow(): Promise<void> {
  vs.request = val("req") || vs.request;
  const r = await call<BuiltPrompt>("buildPrompt", { goal: vs.goal, request: vs.request, mustNotChange: vs.mustNotChange, acceptance: vs.acceptance, beginner: beginner(), planFirst: vs.planFirst });
  built = r;
  promptText = r.text;
  render();
  document.getElementById("ptext")?.scrollIntoView({ block: "nearest" });
}

async function addReq(): Promise<void> {
  const t = val("newReq");
  if (!t) return;
  await call("addRequirement", { title: t, acceptance: val("newAcc") });
}

async function act(el: HTMLElement): Promise<void> {
  const a = el.dataset.act!;
  switch (a) {
    case "build": return buildNow();
    case "promptFor":
      vs.tab = "prompts";
      vs.goal = el.dataset.goal || "feature";
      vs.request = el.dataset.request || "";
      persist();
      if (vs.request) return buildNow();
      built = null;
      return render();
    case "copyPrompt": return void call("copy", { text: promptText });
    case "sendPrompt": return void call("sendToClaude", { text: promptText });
    case "refine": {
      const r = await call<{ text: string } | null>("refine", { text: promptText });
      if (r?.text) { promptText = r.text; render(); }
      return;
    }
    case "copyHandoff": {
      const h = await call<string>("handoff");
      return void call("copy", { text: h });
    }
    case "handoffPrompt":
      vs.tab = "prompts";
      vs.goal = "handoff";
      vs.request = "Continue where the previous session left off.";
      persist();
      return buildNow();
    case "runScript": return void call("runScript", { script: el.dataset.script });
    case "dismiss": return void call("dismiss", { key: el.dataset.key });
    case "saveNote": return void call("setNote", { key: el.dataset.key, value: val(el.dataset.src!) });
    case "addReq": return addReq();
    case "delReq": return void call("deleteRequirement", { id: el.dataset.id });
    case "editAcc": {
      const li = el.closest("li");
      const title = li?.querySelector(".req-title")?.textContent ?? "";
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = `Done when… (for "${title}")`;
      el.replaceWith(input);
      input.focus();
      input.addEventListener("keydown", (e) => { if (e.key === "Enter" && input.value.trim()) void call("updateRequirement", { id: el.dataset.id, patch: { acceptance: input.value.trim() } }); });
      return;
    }
    case "addDec": {
      const t = val("newDec");
      if (t) await call("addDecision", { title: t, detail: val("newDecD") });
      return;
    }
    case "delDec": return void call("deleteDecision", { id: Number(el.dataset.id) });
    case "cpDiff": {
      cpFiles[el.dataset.sha!] = await call<string[]>("checkpointDiff", { sha: el.dataset.sha });
      return render();
    }
    case "rollback": {
      const sha = el.dataset.sha!;
      const files = [...document.querySelectorAll<HTMLInputElement>(`input.cpf[data-sha="${sha}"]:checked`)].map((i) => i.value);
      if (!files.length) return;
      await call("rollback", { sha, files });
      cpFiles = {};
      return render();
    }
    case "demoOn": return void call("demo", { on: true });
    case "demoOff": return void call("demo", { on: false });
    case "setWebhook": await call("setWebhook"); hasWebhook = await call<boolean>("hasWebhook"); return render();
    default: return void call(a);
  }
}

// boot
void call<GoalSpec[]>("goals").then((g) => { goals = g ?? []; render(); });
vscode.postMessage({ type: "ready" });
