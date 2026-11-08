/* BuildPilot: one calm page. Plain TypeScript + DOM, no framework: small, fast, CSP-safe. */
import type { UiState } from "../core/engine";
import type { PageData } from "../core/page";
import type { BuiltPrompt } from "../core/prompts";
import { guessGoal } from "../core/goal";

declare function acquireVsCodeApi(): { postMessage(m: unknown): void; getState(): unknown; setState(s: unknown): void };
const vscode = acquireVsCodeApi();

interface ViewState { request: string }
const vs: ViewState = { request: "", ...((vscode.getState() as Partial<ViewState> | undefined) ?? {}) };
const persist = () => vscode.setState(vs);

let S: UiState | null = null;
let P: PageData | null = null;
let trusted = true;
let theme: "white" | "match" = "white";
/** Standalone window with no saved choice: follow the system light/dark setting. */
let themePref = "white";
const systemDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
if (typeof matchMedia === "function") matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
  if (themePref !== "auto") return;
  theme = systemDark() ? "match" : "white";
  render();
});
let standalone = false;
let alertsOn = true;
const FREE = 20;
let promptText = "";
let built: BuiltPrompt | null = null;
let paywalled = false;
let lastKey = "";

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
  const m = e.data as { type: string; id?: number; result?: unknown; state?: UiState; page?: PageData; settings?: { trusted?: boolean; theme?: string; standalone?: boolean; alerts?: boolean } };
  if (m.type === "reply" && m.id) {
    waiting.get(m.id)?.(m.result);
    waiting.delete(m.id);
  } else if (m.type === "state") {
    S = m.state ?? null;
    P = m.page ?? null;
    trusted = m.settings?.trusted ?? true;
    themePref = m.settings?.theme ?? "white";
    theme = themePref === "match" || (themePref === "auto" && systemDark()) ? "match" : "white";
    standalone = !!m.settings?.standalone;
    alertsOn = m.settings?.alerts !== false;
    // Skip re-rendering when nothing visible changed (the 30 s tick only moves the clock).
    const key = JSON.stringify({ p: P, n: S?.project?.root, a: S?.analyzing, t: Math.floor((S?.generatedAt ?? 0) / 60_000), trusted, theme });
    if (key === lastKey) return;
    lastKey = key;
    render();
  } else if (m.type === "navigate") {
    document.getElementById("req")?.focus();
  }
});

// ---------- helpers ----------
const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}
/** First line of a task or prompt, clipped, so rows stay one tidy line. */
function clip(text: string | null | undefined, max = 90): string {
  if (!text) return "";
  const t = (text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "").replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
/** One set of thresholds everywhere: chat 70 / 90 % full, plan limits 80 / 95 % used. */
const toneChat = (pct: number | null) => (pct == null ? "none" : pct >= 90 ? "bad" : pct >= 70 ? "warn" : "ok");
const tone = (pct: number | null) => (pct == null ? "none" : pct >= 95 ? "bad" : pct >= 80 ? "warn" : "ok");

let flashTimer: ReturnType<typeof setTimeout> | null = null;
function flash(text: string): void {
  const el = document.getElementById("flash");
  if (el) { el.textContent = text; el.classList.add("on"); }
  const live = document.getElementById("live");
  if (live) live.textContent = text;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => document.getElementById("flash")?.classList.remove("on"), 2400);
}

/** The BuildPilot mark (inline so it works in VS Code and the standalone window without loading files). */
const MARK = `<svg class="mark" viewBox="0 0 512 512" aria-hidden="true" focusable="false"><defs><linearGradient id="bpg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4C78FF"/><stop offset="1" stop-color="#1F3BC9"/></linearGradient></defs><rect x="16" y="16" width="480" height="480" rx="112" fill="url(#bpg)"/><circle cx="256" cy="256" r="158" fill="none" stroke="#FFFFFF" stroke-opacity=".22" stroke-width="30"/><circle cx="256" cy="256" r="158" fill="none" stroke="#FFFFFF" stroke-width="30" stroke-linecap="round" stroke-dasharray="700 993" transform="rotate(135 256 256)"/><path d="M176 200 L236 252 L176 304" fill="none" stroke="#FFFFFF" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/><rect x="262" y="286" width="82" height="34" rx="17" fill="#FFFFFF"/></svg>`;

/** Small ring that fills as the chat fills up. */
function ring(pct: number): string {
  const r = 7;
  const c = 2 * Math.PI * r;
  const v = Math.min(100, Math.max(0, pct));
  return `<svg class="ring tone-${pct < 70 ? "calm" : tone(pct)}" viewBox="0 0 18 18" aria-hidden="true" focusable="false"><circle cx="9" cy="9" r="${r}" class="ring-bg"/><circle cx="9" cy="9" r="${r}" class="ring-fg" stroke-dasharray="${((v / 100) * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 9 9)"/></svg>`;
}

/** One calm line at the top when something needs attention (most urgent first, max 2). */
function headsUp(): string {
  if (!P || !P.connected) return "";
  const items: string[] = [];
  const need = P.builds.find((b) => b.needsYou);
  if (need) items.push(`<div class="hu hu-need"><span><b>${esc(need.name ?? need.folder)}</b> needs your OK${need.waitingFor ? `: <code>${esc(clip(need.waitingFor, 60))}</code>` : ""}</span><button class="primary small-btn" data-act="openBuild" data-cwd="${esc(need.cwd)}" data-id="${esc(need.id)}">${standalone ? "Go to tab" : "Review"}</button></div>`);
  const L = P.limits;
  if ((L.fiveHourPct ?? 0) >= 80) {
    const hog = [...P.builds].filter((b) => b.share != null && b.agent !== "codex").sort((a, b) => b.share! - a.share!)[0];
    const act = hog && P.builds.length > 1 && (hog.share ?? 0) >= 30 ? `<button class="secondary small-btn" data-act="tip" data-tip="pause" data-cwd="${esc(hog.cwd)}" title="Opens its terminal so you can press Esc to pause it. Your files are kept.">Pause ${esc(hog.name ?? hog.folder)} (${hog.share}%)</button>` : "";
    items.push(`<div class="hu hu-limit"><span><b>${Math.round(L.fiveHourPct!)}%</b> of your 5-hour limit used${L.fullAt ? ` · runs out around <b>${clock(L.fullAt)}</b>` : ""}${L.fiveHourResetsAt ? ` · back at ${clock(L.fiveHourResetsAt)}` : ""}</span>${act}</div>`);
  }
  const stopped = P.builds.find((b) => b.stopped);
  if (stopped && items.length < 2) items.push(`<div class="hu hu-stop"><span><b>${esc(stopped.name ?? stopped.folder)}</b> stopped mid-task</span><button class="secondary small-btn" data-act="resumeBuild" data-id="${esc(stopped.id)}" data-cwd="${esc(stopped.cwd)}">Resume</button></div>`);
  const err = P.builds.find((b) => (b.errors1h ?? 0) >= 3);
  if (err && items.length < 2) items.push(`<div class="hu hu-err"><span><b>${esc(err.name ?? err.folder)}</b> hit ${err.errors1h} errors this hour</span><button class="secondary small-btn" data-act="toggleErrors" data-id="${esc(err.id)}">See them</button></div>`);
  return items.length ? `<section class="headsup" aria-label="Needs attention">${items.slice(0, 2).join("")}</section>` : "";
}

// ---------- render ----------
/** Stable identity for a control without an id, so keyboard focus survives a re-render. */
const FOCUS_ATTRS = ["data-act", "data-id", "data-cwd", "data-dir", "data-tip", "data-path", "data-branch"];
function focusKey(el: Element | null): string | null {
  if (!el || el === document.body || el.id) return null;
  const parts = FOCUS_ATTRS.filter((a) => el.hasAttribute(a)).map((a) => `[${a}="${CSS.escape(el.getAttribute(a)!)}"]`).join("");
  return parts ? `${el.tagName.toLowerCase()}${parts}` : null;
}

let lastSpoken = "";
/** Tell screen-reader users about new things that need them (polite, once per change). */
function announce(): void {
  if (!P) return;
  const parts: string[] = [];
  const needs = P.builds.filter((b) => b.needsYou);
  if (needs.length) parts.push(`${needs.map((b) => b.name ?? b.folder).join(", ")} ${needs.length === 1 ? "needs" : "need"} you`);
  if ((P.limits.fiveHourPct ?? 0) >= 80) parts.push(`${Math.round(P.limits.fiveHourPct!)} percent of your 5-hour limit used`);
  const msg = parts.join(". ");
  if (msg && msg !== lastSpoken) { const el = document.getElementById("live"); if (el) el.textContent = msg; }
  lastSpoken = msg;
}

function render(): void {
  const app = document.getElementById("app")!;
  const focusedId = (document.activeElement as HTMLElement | null)?.id;
  const fKey = focusKey(document.activeElement);
  const sel = (document.activeElement as HTMLTextAreaElement | null)?.selectionStart ?? null;
  if (!S || !P) {
    app.innerHTML = `<div class="loading">Starting BuildPilot…</div>`;
    return;
  }
  document.body.classList.toggle("match", theme === "match");
  document.body.classList.toggle("sa", standalone); // own window: no VS Code theme variables, so dark colors come from style.css
  app.innerHTML = `
  <main class="page">
    <header class="head">
      <h1 class="brand">${MARK}<span>Build<b>Pilot</b></span></h1>
      ${planPill()}
      ${standalone ? `<button class="link proj" data-act="selectProject" title="Prompts, tips and side builds use this project">Project: ${esc(S.facts?.name ?? S.project?.name ?? "choose")} ▾</button>` : ""}
    </header>
    ${trialNotice()}
    ${headsUp()}
    ${!trusted ? `<p class="note">This folder isn't trusted, so BuildPilot can look but won't change anything.</p>` : ""}
    ${!P.connected ? connectCard() : `<div class="cols"><div class="col-main">${buildsSection()}</div><div class="col-side">${limitsSection()}${tipsSection()}${promptSection()}</div></div>`}
    <footer class="foot">
      <button type="button" class="linkbtn" data-act="more" title="Dependency check, app check, save points and undo, handoff, phone alerts and more">Advanced tools</button> · <button type="button" class="linkbtn" data-act="toggleTheme" data-to="${theme === "match" ? "white" : "match"}">${theme === "match" ? "White page" : standalone ? "Dark page" : "Match my theme"}</button>${standalone ? ` · <button type="button" class="linkbtn" data-act="toggleAlerts" title="Mac notifications when a build needs you, you're near your limit, errors pile up, or a chat compacts">Alerts ${alertsOn ? "on" : "off"}</button>` : ""}${P.connected ? `<span class="sep" aria-hidden="true"></span><button type="button" class="linkbtn danger" data-act="disconnect">Disconnect</button>` : ""}
    </footer>
  </main>
  <div id="flash" class="flash" aria-hidden="true"></div>`;
  const req = document.getElementById("req") as HTMLTextAreaElement | null;
  if (req) req.value = vs.request;
  const out = document.getElementById("ptext") as HTMLTextAreaElement | null;
  if (out) out.value = promptText;
  bind();
  announce();
  if (focusedId || fKey) {
    let el = (focusedId ? document.getElementById(focusedId) : null) as HTMLTextAreaElement | null;
    if (!el && fKey) try { el = document.querySelector(fKey) as HTMLTextAreaElement | null; } catch { /* bad selector */ }
    el?.focus({ preventScroll: true });
    if (el && sel != null && "setSelectionRange" in el) try { el.setSelectionRange(sel, sel); } catch { /* not text */ }
  }
}

function planPill(): string {
  const p = P!.plan;
  if (p.licensed) return `<span class="pill">Pro</span>`;
  if (!p.sellable) return "";
  if (p.trialDaysLeft != null && p.trialDaysLeft <= 3) return "";
  if (p.trialDaysLeft != null) return `<span class="pill soft" title="Every Pro feature is on during your trial. After it, builds, limits, the forecast, tips, 20 prompts and 2 builds at once stay free.">Pro trial · ${p.trialDaysLeft} day${p.trialDaysLeft === 1 ? "" : "s"} left</span>`;
  return "";
}

function trialNotice(): string {
  const p = P!.plan;
  if (!p.sellable || p.licensed || p.trialDaysLeft == null || p.trialDaysLeft > 3) return "";
  const day = p.trialEndsAt ? new Date(p.trialEndsAt).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }) : "soon";
  return `<p class="note" title="After the trial: 2 builds at once, no tests-before-merge, no per-build usage. Limits, forecast and tips stay free. Nothing is charged unless you choose Pro.">Pro trial ends ${esc(day)}. No card on file. <a href="#" data-act="upgrade">Keep Pro · ${esc(p.price)}</a></p>`;
}

function connectCard(): string {
  return `<section class="card connect">
    <div class="hero">${MARK}<div><h2>Connect Claude Code</h2><p class="muted small">Every build, what needs you, your limits and where your tokens go, in one calm window.</p></div></div>
    <p>BuildPilot adds a few lines to your Claude Code settings so it can see your builds, how full each chat is, and your plan limits. Your settings are backed up first, nothing leaves this computer, and you can disconnect anytime.</p>
    <div class="actions"><button class="primary" data-act="connectAll">Connect</button><button class="link" data-act="showConnectChanges">See exactly what changes</button></div>
  </section>
  <section class="preview" aria-label="What you'll see">
    <h2 class="label">What you'll see</h2>
    <ul class="feat">
      <li><b>Every build, live.</b> What each Claude chat is doing right now, which one needs you, and errors as they happen.</li>
      <li><b>Your limits, ahead of time.</b> 5-hour and weekly use, when it resets, and when you'll run out at your pace.</li>
      <li><b>Where your tokens go.</b> The biggest things eating each chat, with tips to cut them.</li>
      <li><b>Safe parallel builds.</b> Start a second Claude in its own copy, then review and merge.</li>
    </ul>
  </section>`;
}

const STATUS_WORD: Record<string, string> = { running: "Working", idle: "Your turn", blocked: "Needs your answer", awaiting_approval: "Needs your OK", completed: "Closed", failed: "Failed", unknown: "Quiet" };

type Build = PageData["builds"][number];
const expanded = new Set<string>();
const errOpen = new Set<string>();
let showQuiet = false;
let fileQuery = "";
let fileResults: { sessionId: string; cwd: string; path: string; file: string; lastTs: number; edits: number }[] | null = null;
let finderOpen = false;

const kTok = (n: number) => (n >= 1000 ? `${n >= 10000 ? Math.round(n / 1000) : (n / 1000).toFixed(1)}k` : String(n));
const shortModel = (m: string) => m.replace(/^claude-/, "").replace(/-\d{8}$/, "").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/-/g, " ").replace(/\b(\w)/g, (c) => c.toUpperCase());
const isQuiet = (x: Build) => !x.needsYou && !x.stopped && x.status !== "running" && Date.now() - x.lastEventAt > 2 * 3600_000;
const dur = (since: number | null | undefined) => {
  if (!since) return "";
  const m = Math.round((Date.now() - since) / 60_000);
  return m < 1 ? "" : ` · ${m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`}`;
};

function buildSub(x: Build): string {
  if (x.agent === "codex") return x.now ? `<b class="nowtxt">${esc(x.now)}</b>${dur(x.nowSince)}` : `${esc(clip(x.task, 70) || x.word)} · ${ago(x.lastEventAt)}`;
  if (x.needsYou) return `${ago(x.lastEventAt) === "just now" ? "Waiting" : `Waiting ${ago(x.lastEventAt).replace(" ago", "")}`} · ${esc(clip(x.waitingFor ?? x.reason, 80) || STATUS_WORD[x.status])}`;
  if (x.stopped) return `<span class="warn-text">Stopped mid-task</span> · ${esc(clip(x.task, 60))}`;
  if (x.maybeStuck) return x.now && x.now !== "Thinking" ? `<span class="warn-text">${esc(x.now)}${dur(x.nowSince)}, may be stuck</span>` : `<span class="warn-text">Quiet for ${Math.round((Date.now() - x.lastEventAt) / 60_000)} min, may be stuck</span>`;
  if (x.now) return `<b class="nowtxt" title="${esc(x.nowFull ?? x.now)}">${esc(x.now)}</b>${dur(x.nowSince)}`;
  if (x.finishedAt && x.turnMs && Date.now() - x.finishedAt < 15 * 60_000) return `<span class="ok-text">Finished · your turn</span> · ${esc(clip(x.task, 50))}`;
  return `${esc(clip(x.task, 70) || STATUS_WORD[x.status] || x.word)} · ${ago(x.lastEventAt)}`;
}

/** "Step 3 of 7 · Adding login" from Claude's own checklist, else what this request has done so far and whether it's proven. */
function progressLine(x: Build): string {
  if (x.agent === "codex" || x.needsYou) return "";
  const c = x.checklist;
  if (c && c.total > 1 && c.done < c.total) {
    return `<div class="b-prog"><span class="steps" title="${esc(c.items.map((i) => `${i.status === "completed" ? "✓" : i.status === "in_progress" ? "→" : "·"} ${i.title}`).join("\n"))}">Step ${Math.min(c.done + 1, c.total)} of ${c.total}</span>${c.current ? ` · ${esc(clip(c.current, 70))}` : ""}<span class="pbar" aria-hidden="true"><span style="width:${Math.round((c.done / c.total) * 100)}%"></span></span></div>`;
  }
  const t = x.turn;
  if (!t || (!t.steps && !t.files)) return "";
  const proof = t.proof === "verified" ? `<span class="ok-text">✓ tests passed after the last change</span>` : t.proof === "failing" ? `<span class="bad-text">✗ tests failing</span>` : t.proof === "unverified" ? `<span class="warn-text">${t.done ? "finished, not tested yet" : "not tested yet"}</span>` : "";
  const parts = [`${t.steps} step${t.steps === 1 ? "" : "s"}`, t.files ? `${t.files} file${t.files === 1 ? "" : "s"} changed` : "", proof].filter(Boolean);
  return `<div class="b-prog">${parts.join(" · ")}</div>`;
}

function buildRow(x: Build): string {
  const label = x.name ?? x.folder;
  const chips = [
    x.agent === "codex" ? `<span class="chip codex" title="Read from Codex's own logs. Codex has no hooks, so approvals and errors aren't shown here.">Codex</span>` : "",
    (x.errors1h ?? 0) > 0 ? `<button class="chip err" data-act="toggleErrors" data-id="${esc(x.id)}" title="Errors in the last hour">${x.errors1h} error${x.errors1h === 1 ? "" : "s"}</button>` : "",
    x.autoApprove && !P!.builds.every((b) => b.autoApprove || b.agent === "codex") ? `<span class="chip warn" title="Running with permissions skipped: Claude won't ask before running commands">auto-approve on</span>` : "",
  ].join("");
  const errPanel = errOpen.has(x.id) && (x.lastErrors ?? []).length ? `<div class="errpanel"><ul>${(x.lastErrors ?? []).map((e) => `<li><code>${esc(e)}</code></li>`).join("")}</ul><button class="link" data-act="copyErrors" data-id="${esc(x.id)}">Copy for Claude</button></div>` : "";
  return `<li class="${x.needsYou ? "needs" : ""}${expanded.has(x.id) ? " open" : ""}">
    <span class="dot dot-${x.stopped ? "failed" : x.status}" aria-hidden="true"></span>
    <div class="b-main">
      <div class="b-name"><button class="name-btn" data-act="toggleBuild" data-id="${esc(x.id)}" aria-expanded="${expanded.has(x.id)}" aria-controls="d-${esc(x.id)}" title="Show what it did and where the tokens went"><span class="chev" aria-hidden="true">${expanded.has(x.id) ? "▾" : "▸"}</span>${esc(label)}</button>${x.hint ? `<span class="hint">${esc(x.hint)}</span>` : ""}${x.agent !== "codex" ? `<button class="pencil" data-act="renameBuild" data-id="${esc(x.id)}" title="Name this session" aria-label="Name this session">✎</button>` : ""}${chips}</div>
      <div class="b-sub" title="${esc(x.cwd)}${x.task ? `\n\n${esc(x.task.slice(0, 600))}` : ""}">${buildSub(x)}</div>
      ${progressLine(x)}
      ${x.task && x.agent !== "codex" && !x.stopped && !(x.finishedAt && Date.now() - x.finishedAt < 15 * 60_000) ? `<div class="b-task" title="${esc(x.task.slice(0, 600))}">“${esc(clip(x.task, 110))}”</div>` : ""}
      ${(x.risks ?? []).length ? `<div class="b-risk" role="note"><span aria-hidden="true">⚠</span> ${esc(x.risks![0]!)}${x.risks!.length > 1 ? ` <span class="muted">+${x.risks!.length - 1} more</span>` : ""}</div>` : ""}
      ${errPanel}
    </div>
    <div class="b-meta">${x.contextPct != null ? `<span class="mem tone-${toneChat(x.contextPct)}" title="How full this chat is. From 70% Claude starts to lose details; a fresh chat with a summary keeps it sharp.">${ring(x.contextPct)}chat ${Math.round(x.contextPct)}% full</span>` : ""}${x.costUsd != null ? `<span class="share" title="Claude Code's own estimate for this build today">~$${x.costUsd.toFixed(2)}</span>` : x.share != null && x.share >= 1 ? `<span class="share" title="This build's share of all your Claude Code usage today, from Claude Code's own cost estimate">${x.share}% of today's use</span>` : x.codexTokens ? `<span class="share">${kTok(x.codexTokens)} tokens</span>` : ""}</div>
    <div class="b-act">${x.agent === "codex" ? `<span class="muted small" title="Codex has no hooks, so BuildPilot can only read its logs">read-only</span>` : buildButton(x)}</div>
    ${expanded.has(x.id) ? buildDetails(x) : ""}
  </li>`;
}

function buildDetails(x: Build): string {
  const t = x.tokens;
  const tok = t
    ? `<div class="tokens"><div class="d-head">Where the tokens went</div>
        <p class="small">${t.baseline != null ? `Started at <b>${kTok(t.baseline)}</b> before your first message` : "Start size unknown"} · chat now ${t.context != null ? `<b>${kTok(t.context)}</b>` : "unknown"} · ${t.inputTotal ? `sent ≈${kTok(t.inputTotal)} in total · ` : ""}Claude wrote ${kTok(t.output)} · ${t.turns} repl${t.turns === 1 ? "y" : "ies"}${t.models.length ? ` · ${t.models.map(([m, n]) => `${esc(shortModel(m))}${t.models.length > 1 ? ` ×${n}` : ""}`).join(", ")}` : ""}${t.subagents ? ` · ${t.subagents} subagent${t.subagents === 1 ? "" : "s"}` : ""}${t.compactions ? ` · compacted ${t.compactions}×` : ""}</p>
        ${t.top ? (t.top.length ? `<ul class="toklist">${t.top.map((i) => `<li><span>${esc(i.label)}</span><span class="muted">≈${kTok(i.tokens)}</span></li>`).join("")}</ul><p class="muted tiny">Biggest things pulled into the chat (≈ estimated from size). They're re-sent with every message until a fresh chat.</p>` : `<p class="muted tiny">No large tool output yet.</p>`) : P!.plan.sellable ? `<p class="small"><a href="#" data-act="upgrade">See exactly what used them · Pro</a></p>` : ""}
      </div>`
    : x.agent === "codex" ? "" : `<p class="muted tiny">Token details appear once this build has a transcript BuildPilot can read.</p>`;
  // Repeated steps in a row ("Looked through files" ×7) collapse into one line.
  const steps: { ts: number; text: string; error: boolean; full?: string; n: number }[] = [];
  for (const e of x.timeline ?? []) {
    const prev = steps[steps.length - 1];
    if (prev && prev.text === e.text && prev.error === e.error) prev.n++;
    else steps.push({ ...e, n: 1 });
  }
  const risks = (x.risks ?? []).length ? `<div class="d-head">Worth a look</div><ul class="risks">${x.risks!.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : "";
  const list = x.checklist && x.checklist.total ? `<div class="d-head">Claude's checklist · ${x.checklist.done} of ${x.checklist.total} done</div><ul class="checklist">${x.checklist.items.slice(0, 20).map((i) => `<li class="${i.status}"><span aria-hidden="true">${i.status === "completed" ? "✓" : i.status === "in_progress" ? "→" : "○"}</span> ${esc(i.title)}</li>`).join("")}</ul>` : "";
  const tl = steps.length
    ? `${risks}${list}<div class="d-head">Recent steps</div><ol class="timeline">${steps.map((e) => `<li class="${e.error ? "bad" : ""}" title="${esc(e.full ?? e.text)}"><span class="muted t">${new Date(e.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span><span class="x">${esc(e.text)}${e.n > 1 ? ` <span class="muted">×${e.n}</span>` : ""}</span></li>`).join("")}</ol>`
    : `${risks}${list}`;
  return `<div class="details" id="d-${esc(x.id)}">${tok}${tl}</div>`;
}

function fileFinder(): string {
  return `<div class="finder">
    <label class="lbl" for="fileq">Who changed a file?</label>
    <div class="finder-row"><input id="fileq" type="text" placeholder="e.g. checkout.tsx" value="${esc(fileQuery)}"><button class="secondary small-btn" data-act="whoChanged">Find</button></div>
    ${fileResults == null ? "" : fileResults.length ? `<ul class="files">${fileResults.map((r) => `<li><div><b>${esc(r.file)}</b> <span class="muted small">changed ${r.edits}× by ${esc(P!.builds.find((b) => b.id === r.sessionId)?.name ?? P!.builds.find((b) => b.id === r.sessionId)?.folder ?? r.cwd.split("/").pop() ?? "a build")}, ${ago(r.lastTs)}</span></div>${fileResults!.filter((o) => o.path === r.path).length > 1 ? `<span class="warn-text small" title="Undo goes back to the last commit, so it also removes the other builds' changes to this file">changed by ${fileResults!.filter((o) => o.path === r.path).length} builds</span>` : ""}<button class="link" data-act="undoFile" data-path="${esc(r.path)}" title="Put this file back to its last saved (committed) version. This removes every build's changes to it since then.">Undo this file</button></li>`).join("")}</ul>` : `<p class="muted small">No build has changed a file matching “${esc(fileQuery)}” recently.</p>`}
  </div>`;
}

function buildsSection(): string {
  const all = P!.builds;
  const active = all.filter((x) => !isQuiet(x));
  const quiet = all.filter(isQuiet);
  const summary = !all.length
    ? "No Claude sessions running"
    : `${active.length} session${active.length === 1 ? "" : "s"}${P!.working ? ` · ${P!.working} working` : ""}${P!.needs ? ` · <b class="need">${P!.needs} need${P!.needs === 1 ? "s" : ""} you</b>` : ""}`;
  // Group by project when a project has 2+ builds; most urgent group first.
  const groups = new Map<string, Build[]>();
  for (const x of active) groups.set(x.folder, [...(groups.get(x.folder) ?? []), x]);
  const urgency = (xs: Build[]) => Math.min(...xs.map((x) => (x.needsYou ? 0 : x.stopped ? 1 : (x.errors1h ?? 0) > 0 ? 2 : x.status === "running" ? 3 : 4)));
  const ordered = [...groups.entries()].sort((a, b) => urgency(a[1]) - urgency(b[1]) || Math.max(...b[1].map((x) => x.lastEventAt)) - Math.max(...a[1].map((x) => x.lastEventAt)));
  // Once any project has 2+ builds, label every project so rows never look like they belong to the group above.
  const multi = ordered.filter(([, xs]) => xs.length > 1);
  const singles = ordered.filter(([, xs]) => xs.length === 1).flatMap(([, xs]) => xs);
  const head = (label: string, count?: number) => `<li class="group"><h3 class="group-h">${esc(label)}</h3>${count ? `<span class="count">${count} sessions</span>` : ""}</li>`;
  const list = multi.length
    ? multi.map(([name, xs]) => head(name, xs.length) + xs.map(buildRow).join("")).join("") + (singles.length ? head("Other sessions") + singles.map(buildRow).join("") : "")
    : ordered.flatMap(([, xs]) => xs).map(buildRow).join("");
  return `<section class="block" aria-label="Sessions">
    <div class="row-head"><h2 class="status">${summary}</h2><button class="secondary" data-act="newBuild" title="Starts another Claude in a separate copy of this project (a side build), so two sessions can't undo each other's work">+ New side build</button></div>
    ${all.length ? `<ul class="builds">${list}${quiet.length ? `<li class="quiet"><button class="link" data-act="toggleQuiet">${showQuiet ? "Hide" : "Show"} ${quiet.length} quiet session${quiet.length === 1 ? "" : "s"}</button> · <button class="link" data-act="hideIdle">Clear them</button></li>${showQuiet ? quiet.map(buildRow).join("") : ""}` : ""}</ul>` : `<p class="muted">Type <code>claude</code> in a terminal. Sessions show up here as soon as Claude does something.</p>`}
    ${earlierSection()}
    ${sideSection()}
    ${all.length ? (finderOpen || fileResults != null ? fileFinder() : `<p class="finder-link"><button class="link" data-act="openFinder">Who changed a file?</button></p>`) : ""}
  </section>`;
}

/** Sessions that finished earlier today, with whether their last change was proven. */
function earlierSection(): string {
  const e = P!.earlier ?? [];
  if (!e.length) return "";
  const proof = (p: string | null, files: number) => p === "verified" ? `<span class="ok-text">✓ tests passed</span>` : p === "failing" ? `<span class="bad-text">✗ tests failing</span>` : p === "unverified" ? `<span class="warn-text">${files} file${files === 1 ? "" : "s"} changed, not tested</span>` : "";
  return `<div class="earlier"><h3 class="group-h">Earlier today</h3><ul>${e.map((x) => `<li><span class="e-name">${esc(x.folder)}</span> <span class="muted small">${new Date(x.endedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>${x.task ? ` <span class="muted small" title="${esc(x.task)}">· “${esc(clip(x.task, 60))}”</span>` : ""}${proof(x.proof, x.files) ? ` <span class="small">· ${proof(x.proof, x.files)}</span>` : ""}</li>`).join("")}</ul></div>`;
}

function sideSection(): string {
  const side = P!.side ?? [];
  if (!side.length) return "";
  return `<div class="side"><ul class="builds"><li class="group"><h3 class="group-h">Side builds</h3><span class="count">review &amp; merge</span></li>${side
    .map((s) => `<li>
      <div class="b-main"><div class="b-name">${esc(s.name)}</div><div class="b-sub">${s.changed ? `${s.changed} file${s.changed === 1 ? "" : "s"} changed${s.unsaved ? " · not saved yet" : ""}` : "No changes yet"}</div></div>
      ${s.changed ? `<button class="secondary small-btn" data-act="reviewBuild" data-dir="${esc(s.dir)}" data-branch="${esc(s.branch)}" title="See each changed file, before and after">Review</button><button class="secondary small-btn" data-act="mergeBuild" data-dir="${esc(s.dir)}" data-branch="${esc(s.branch)}" title="Bring this build's work into your main project">Merge</button>` : `<button class="link" data-act="removeBuild" data-dir="${esc(s.dir)}" title="Remove this folder (its branch is kept)">Remove</button>`}
    </li>`)
    .join("")}</ul></div>`;
}

function buildButton(x: PageData["builds"][number]): string {
  const featured = x.needsYou && P!.builds.find((b) => b.needsYou)?.id === x.id;
  if (!standalone) return `<button class="${x.needsYou ? (featured ? "secondary small-btn" : "primary") : "link"}" data-act="openBuild" data-cwd="${esc(x.cwd)}" data-id="${esc(x.id)}" title="${x.needsYou ? "Opens its terminal. Nothing is approved until you approve it there." : "Opens its terminal"}">${x.needsYou ? "Review in terminal" : "Open terminal"}</button>`;
  if (x.needsYou) return `<button class="${featured ? "secondary small-btn" : "primary"}" data-act="openBuild" data-cwd="${esc(x.cwd)}" data-id="${esc(x.id)}" title="Brings its Terminal, iTerm or tmux tab forward. Nothing is approved until you approve it there.">Go to tab</button>`;
  const fresh = (x.contextPct ?? 0) >= 70 && x.status !== "running" ? `<button class="link" data-act="startFresh" data-cwd="${esc(x.cwd)}" title="Copies a summary of the work so far and opens a new Claude in this folder">Start fresh</button>` : "";
  if (x.stopped) return `${fresh}<button class="link" data-act="resumeBuild" data-id="${esc(x.id)}" data-cwd="${esc(x.cwd)}" title="Reopens this Claude conversation in Terminal">Resume</button>`;
  return `${fresh}<button class="link" data-act="openBuild" data-cwd="${esc(x.cwd)}" data-id="${esc(x.id)}" title="Brings its Terminal, iTerm or tmux tab forward">Go to tab</button>`;
}

function bar(label: string, pct: number | null, right: string): string {
  return `<div class="meter">
    <div class="m-top"><span>${label}</span><span class="muted">${right}</span></div>
    <div class="track" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" ${pct != null ? `aria-valuenow="${Math.round(pct)}"` : ""}><div class="fill tone-${tone(pct)}" style="width:${Math.min(100, Math.max(0, pct ?? 0))}%"></div></div>
  </div>`;
}

function weekday(t: number): string {
  return `${new Date(t).toLocaleDateString([], { weekday: "long" })} ${clock(t)}`;
}

function limitsSection(): string {
  const L = P!.limits;
  if (P!.billing === "api") {
    return `<section class="block" aria-label="Spend"><h2 class="label">Spend today</h2><p class="big">${P!.costTodayUsd != null ? `~$${P!.costTodayUsd.toFixed(2)}` : "—"}</p><p class="muted small">Claude Code's own estimate for your API key, across all builds today.</p></section>`;
  }
  if (P!.billing === "unknown" || (L.fiveHourPct == null && L.sevenDayPct == null)) {
    return `<section class="block" aria-label="Plan limits"><h2 class="label">Plan limits</h2><p class="muted">Shows up after your next message to Claude.</p></section>`;
  }
  const fiveRight = L.fiveHourPct == null ? "unknown" : `${Math.round(L.fiveHourPct)}% used${L.fiveHourResetsAt ? ` · back to 0% at ${clock(L.fiveHourResetsAt)}` : ""}`;
  const weekRight = L.sevenDayPct == null ? "unknown" : `${Math.round(L.sevenDayPct)}% used${L.sevenDayResetsAt ? ` · resets ${weekday(L.sevenDayResetsAt)}` : ""}`;
  let forecast = "";
  if (L.fullAt && (L.fiveHourPct ?? 0) < 80) {
    const gap = L.fiveHourResetsAt && L.fiveHourResetsAt > L.fullAt ? Math.round((L.fiveHourResetsAt - L.fullAt) / 60_000) : 0;
    const urgent = L.fullAt - Date.now() < 3600_000;
    forecast = `<p class="forecast ${urgent ? "urgent" : ""}" title="${L.basisMin ? `Based on your usage over the last ${L.basisMin} min.` : ""}">At this pace you'll run out around <b>${clock(L.fullAt)}</b>${gap > 0 ? `, then wait ${gap >= 60 ? `${Math.floor(gap / 60)} h ${gap % 60} min` : `${gap} min`} until it's back` : ""} <span class="muted small">(estimate${L.basisMin ? ` from your last ${L.basisMin} min` : ""}).${L.accuracy ? ` ${esc(L.accuracy)}` : ""}</span></p>`;
  }
  return `<section class="block" aria-label="Plan limits"><h2 class="label">Plan limits</h2>${forecast}${bar("Next 5 hours", L.fiveHourPct, fiveRight)}${bar("This week", L.sevenDayPct, weekRight)}${(L.week ?? []).length > 1 ? `<p class="small weekline">This week: ${(L.week ?? []).map((d) => `${esc(d.day)} ${Math.round(d.pct)}%`).join(" → ")}</p>` : ""}${L.weekFullAt ? `<p class="small warn-text">At this pace your week runs out ${weekday(L.weekFullAt)}.</p>` : ""}${L.codex && (L.codex.primaryPct != null || L.codex.secondaryPct != null) ? `<p class="small">Codex: ${L.codex.primaryPct != null ? `${Math.round(L.codex.primaryPct)}% of its short limit` : ""}${L.codex.secondaryPct != null ? ` · ${Math.round(L.codex.secondaryPct)}% weekly` : ""}</p>` : ""}<p class="muted tiny">From Claude Code. The 5-hour window refills on its own; Claude pauses if it reaches 100%.</p></section>`;
}

function tipsSection(): string {
  // One fact, one place: the heads-up strip already shows a hot limit.
  const shown = P!.tips.filter((t) => !(t.key === "limit" && (P!.limits.fiveHourPct ?? 0) >= 80));
  if (!shown.length) return "";
  return `<section class="block" aria-label="Tips"><h2 class="label">Tips for right now</h2><ul class="tips">${shown
    .map((t) => `<li><span>${esc(t.text)}</span>${t.action ? `<button class="secondary small-btn" data-act="tip" data-tip="${t.action}" ${t.cwd ? `data-cwd="${esc(t.cwd)}"` : ""} ${t.id ? `data-id="${esc(t.id)}"` : ""} title="${esc(t.why)}">${esc(t.actionLabel ?? "Do it")}</button>` : ""}</li>`)
    .join("")}</ul></section>`;
}

function paywallCard(): string {
  const p = P!.plan;
  return `<div class="paywall" role="status">
    <b>You've used your ${FREE} free prompts.</b>
    <ul>${p.points.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    <div class="actions"><button class="primary" data-act="upgrade">Get Pro · ${esc(p.price)}</button><button class="link" data-act="enterLicense">I have a license key</button></div>
    <p class="muted tiny">Separate from your Claude plan. Cancel anytime. Watching builds, limits and tips stays free. The checkout link includes a random id only so your payment can be matched to your key.</p>
  </div>`;
}

function promptSection(): string {
  const p = P!.plan;
  const counter = !p.pro && p.freeLeft != null && !paywalled ? `<span class="muted small" title="A prompt only counts when you start or copy it">${p.freeLeft} of ${FREE} free prompts left</span>` : "";
  const folder = S?.facts?.name ?? S?.project?.name ?? "this project";
  return `<section class="block" aria-label="Prompt">
    <h2 class="label">Next prompt</h2>
    <label class="q" for="req">What do you want to build next?</label>
    <textarea id="req" rows="3" placeholder="e.g. Add a contact form that emails me"></textarea>
    <div class="actions center"><button class="primary" data-act="build">Write my prompt</button>${counter}</div>
    ${paywalled ? paywallCard() : ""}
    ${built ? `
      <p class="summary">This asks Claude to <b>${esc(vs.request.trim().replace(/[.!]+$/, ""))}</b> in ${esc(folder)}, using your project's setup, with a short plan first and checks at the end.${built.missingInfo.length ? ` Worth adding: ${esc(built.missingInfo[0]!)}` : ""}</p>
      <label class="lbl" for="ptext">Your prompt. Edit anything.</label>
      <textarea id="ptext" class="mono" rows="${Math.min(40, Math.max(12, promptText.split("\n").length + 1))}"></textarea>
      <div class="actions"><button class="primary" data-act="sendPrompt">Start Claude with this</button><button class="secondary" data-act="useInOpen" title="Copies it and switches to your open terminal, so you can paste it into the Claude chat you already have">Use in my open Claude</button><button class="link" data-act="copyPrompt">Copy</button></div>
      <p class="muted tiny">"Start Claude with this" opens a new terminal in ${esc(folder)}. Your running builds aren't touched.</p>` : ""}
  </section>`;
}

// ---------- events ----------
function bind(): void {
  document.getElementById("req")?.addEventListener("input", (e) => { vs.request = (e.target as HTMLTextAreaElement).value; persist(); });
  document.getElementById("req")?.addEventListener("keydown", (e) => { const k = e as KeyboardEvent; if (k.key === "Enter" && (k.metaKey || k.ctrlKey)) void buildNow(); });
  document.getElementById("fileq")?.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") (document.querySelector('[data-act="whoChanged"]') as HTMLElement | null)?.click(); });
  document.getElementById("ptext")?.addEventListener("input", (e) => { promptText = (e.target as HTMLTextAreaElement).value; });
  document.querySelectorAll<HTMLElement>("[data-act]").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); void act(el); }));
}

async function buildNow(): Promise<void> {
  const text = vs.request.trim();
  if (!text) {
    flash("Type what you want first");
    document.getElementById("req")?.focus();
    return;
  }
  const r = await call<{ prompt: BuiltPrompt; remaining: number | null } | { paywall: { url: string } } | null>("buildPrompt", { goal: guessGoal(text), request: text, beginner: true, planFirst: true, defer: true });
  if (!r) return;
  if ("paywall" in r) {
    paywalled = true;
    built = null;
    return render();
  }
  paywalled = false;
  built = r.prompt;
  promptText = r.prompt.text;
  render();
  document.getElementById("ptext")?.scrollIntoView?.({ block: "nearest" });
}

async function act(el: HTMLElement): Promise<void> {
  const a = el.dataset.act!;
  switch (a) {
    case "build": return buildNow();
    case "toggleTheme": return void call("toggleTheme", { to: el.dataset.to });
    case "copyPrompt": await call("copy", { text: promptText }); void call("promptUsed"); return flash("Copied");
    case "useInOpen": void call("promptUsed"); await call("useInOpen", { text: promptText }); return flash("Copied. Paste it into Claude (Cmd/Ctrl+V)");
    case "sendPrompt": void call("promptUsed"); return void call("sendToClaude", { text: promptText });
    case "openBuild": return void call("openBuild", { cwd: el.dataset.cwd, id: el.dataset.id });
    case "resumeBuild": return void call("resumeBuild", { id: el.dataset.id, cwd: el.dataset.cwd });
    case "toggleBuild": { const id = el.dataset.id!; if (expanded.has(id)) expanded.delete(id); else expanded.add(id); return render(); }
    case "toggleErrors": { const id = el.dataset.id!; if (errOpen.has(id)) errOpen.delete(id); else errOpen.add(id); return render(); }
    case "toggleQuiet": showQuiet = !showQuiet; return render();
    case "copyErrors": {
      const b = P?.builds.find((x) => x.id === el.dataset.id);
      if (!b) return;
      await call("copy", { text: `These errors happened in ${b.folder} (${b.cwd}). Find the root cause before trying another fix:\n\n${(b.lastErrors ?? []).map((e) => `- ${e}`).join("\n")}` });
      return flash("Copied. Paste it into Claude");
    }
    case "openFinder": { finderOpen = true; render(); document.getElementById("fileq")?.focus(); return; }
    case "renameBuild": { await call("renameBuild", { id: el.dataset.id }); return; }
    case "whoChanged": {
      fileQuery = ((document.getElementById("fileq") as HTMLInputElement | null)?.value ?? "").trim();
      if (!fileQuery) { flash("Type a file name"); return; }
      const r = await call<{ files: typeof fileResults } | null>("whoChanged", { query: fileQuery });
      fileResults = r?.files ?? [];
      return render();
    }
    case "undoFile": { await call("undoFile", { path: el.dataset.path }); return; }
    case "reviewBuild": case "mergeBuild": case "removeBuild": return void call(a, { dir: el.dataset.dir, branch: el.dataset.branch });
    case "tip": {
      const t = el.dataset.tip;
      if (t === "startFresh") return void call("startFresh", { cwd: el.dataset.cwd });
      if (t === "setupUndo") return void call("setupUndo");
      if (t === "fixDoubleHooks") return void call("fixDoubleHooks");
      if (t === "resumeBuild") return void call("resumeBuild", { id: el.dataset.id, cwd: el.dataset.cwd });
      if (t === "pause") { await call("openBuild", { cwd: el.dataset.cwd }); return flash("Press Esc in that terminal to pause Claude"); }
      if (t === "goTo") return void call("openBuild", { cwd: el.dataset.cwd, id: el.dataset.id });
      if (t === "checkpoint") { await call("checkpoint"); return flash("Save point made"); }
      if (t === "newBuild") return void call("newBuild");
      if (t === "planMode") {
        vs.request = "Stop. Look at why the last fixes failed, then write a short plan before changing any code.";
        persist();
        return buildNow();
      }
      return;
    }
    default: return void call(a);
  }
}

// boot
const live = document.createElement("div");
live.id = "live";
live.className = "sr-only";
live.setAttribute("role", "status");
live.setAttribute("aria-live", "polite");
document.body.appendChild(live);
// Keyboard: j / k move between sessions, Enter opens details, g goes to its terminal tab, / jumps to the prompt box.
document.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement | null;
  if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) || document.querySelector(".bp-modal")) return;
  const names = [...document.querySelectorAll<HTMLElement>(".builds .name-btn")];
  const i = names.findIndex((n) => n === document.activeElement);
  if (e.key === "j" || e.key === "k") {
    if (!names.length) return;
    e.preventDefault();
    names[e.key === "j" ? Math.min(names.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1)]!.focus();
  } else if (e.key === "g" && i >= 0) {
    e.preventDefault();
    (names[i]!.closest("li")?.querySelector('[data-act="openBuild"],[data-act="resumeBuild"]') as HTMLElement | null)?.click();
  } else if (e.key === "/") {
    const box = document.getElementById("req");
    if (box) { e.preventDefault(); box.focus(); }
  }
});
render();
vscode.postMessage({ type: "ready" });
