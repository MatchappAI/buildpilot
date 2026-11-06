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
  const m = e.data as { type: string; id?: number; result?: unknown; state?: UiState; page?: PageData; settings?: { trusted?: boolean } };
  if (m.type === "reply" && m.id) {
    waiting.get(m.id)?.(m.result);
    waiting.delete(m.id);
  } else if (m.type === "state") {
    S = m.state ?? null;
    P = m.page ?? null;
    trusted = m.settings?.trusted ?? true;
    // Skip re-rendering when nothing visible changed (the 30 s tick only moves the clock).
    const key = JSON.stringify({ p: P, n: S?.project?.root, a: S?.analyzing, t: Math.floor((S?.generatedAt ?? 0) / 60_000), trusted });
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
function until(t: number): string {
  const m = Math.max(0, Math.round((t - Date.now()) / 60_000));
  if (m < 60) return `in ${m} min`;
  if (m < 24 * 60) return `in ${Math.floor(m / 60)} h`;
  return new Date(t).toLocaleDateString([], { weekday: "long" });
}
function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}
const tone = (pct: number | null) => (pct == null ? "none" : pct >= 85 ? "bad" : pct >= 65 ? "warn" : "ok");

let flashTimer: ReturnType<typeof setTimeout> | null = null;
function flash(text: string): void {
  const el = document.getElementById("flash");
  if (el) { el.textContent = text; el.classList.add("on"); }
  const live = document.getElementById("live");
  if (live) live.textContent = text;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => document.getElementById("flash")?.classList.remove("on"), 2400);
}

// ---------- render ----------
function render(): void {
  const app = document.getElementById("app")!;
  const focusedId = (document.activeElement as HTMLElement | null)?.id;
  const sel = (document.activeElement as HTMLTextAreaElement | null)?.selectionStart ?? null;
  if (!S || !P) {
    app.innerHTML = `<div class="loading">Starting BuildPilot…</div>`;
    return;
  }
  app.innerHTML = `
  <main class="page">
    <header class="head">
      <h1>BuildPilot</h1>
      ${P.plan.pro ? `<span class="pill">Pro</span>` : ""}
    </header>
    ${!trusted ? `<p class="note">This folder isn't trusted, so BuildPilot can look but won't change anything.</p>` : ""}
    ${!P.connected ? connectCard() : buildsSection()}
    ${limitsSection()}
    ${tipsSection()}
    ${promptSection()}
    ${P.askCounts ? `<p class="ask small">Help make BuildPilot better by sharing 4 anonymous counts (installed, connected, still using after a week, upgraded)? No names, code or prompts. <a href="#" data-act="countsYes">Yes</a> · <a href="#" data-act="countsNo">No thanks</a></p>` : ""}
    <footer class="foot">
      ${!P.plan.pro && P.plan.freeLeft != null && P.plan.freeLeft <= 5 && !paywalled ? `<span>${P.plan.freeLeft} free prompt${P.plan.freeLeft === 1 ? "" : "s"} left</span> · ` : ""}
      <a href="#" data-act="more">More tools</a>
    </footer>
  </main>
  <div id="flash" class="flash" aria-hidden="true"></div>`;
  const req = document.getElementById("req") as HTMLTextAreaElement | null;
  if (req) req.value = vs.request;
  const out = document.getElementById("ptext") as HTMLTextAreaElement | null;
  if (out) out.value = promptText;
  bind();
  if (focusedId) {
    const el = document.getElementById(focusedId) as HTMLTextAreaElement | null;
    el?.focus({ preventScroll: true });
    if (el && sel != null && "setSelectionRange" in el) try { el.setSelectionRange(sel, sel); } catch { /* not text */ }
  }
}

function connectCard(): string {
  return `<section class="card connect">
    <h2>Connect Claude Code</h2>
    <p>One click lets BuildPilot see your builds, memory and plan limits. Everything stays on this computer.</p>
    <button class="primary" data-act="connectAll">Connect</button>
  </section>`;
}

function buildsSection(): string {
  const b = P!.builds;
  const summary = !b.length
    ? "No builds running."
    : `${b.length} build${b.length === 1 ? "" : "s"}${P!.working ? ` · ${P!.working} working` : ""}${P!.needs ? ` · <b class="need">${P!.needs} need${P!.needs === 1 ? "s" : ""} you</b>` : ""}`;
  return `<section class="block" aria-label="Builds">
    <div class="row-head"><h2 class="status">${summary}</h2><button class="secondary" data-act="newBuild">+ New build</button></div>
    ${b.length ? `<ul class="builds">${b
      .map((x) => `<li class="${x.needsYou ? "needs" : ""}">
        <span class="dot dot-${x.status}" aria-hidden="true"></span>
        <div class="b-main"><div class="b-name">${esc(x.folder)}</div><div class="b-sub">${esc(x.needsYou ? x.reason || x.word : x.task || x.word)} · ${ago(x.lastEventAt)}</div></div>
        ${x.contextPct != null ? `<span class="mem tone-${tone(x.contextPct)}" title="How full this build's memory is">${Math.round(x.contextPct)}% memory</span>` : ""}
        <button class="${x.needsYou ? "primary" : "link"}" data-act="openBuild" data-cwd="${esc(x.cwd)}">${x.needsYou ? "Go" : "Open"}</button>
      </li>`)
      .join("")}</ul>` : `<p class="muted">Run <code>claude</code> in a terminal, or press <b>+ New build</b>.</p>`}
  </section>`;
}

function bar(label: string, pct: number | null, right: string): string {
  return `<div class="meter">
    <div class="m-top"><span>${label}</span><span class="muted">${right}</span></div>
    <div class="track" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" ${pct != null ? `aria-valuenow="${Math.round(pct)}"` : ""}><div class="fill tone-${tone(pct)}" style="width:${Math.min(100, Math.max(0, pct ?? 0))}%"></div></div>
  </div>`;
}

function limitsSection(): string {
  const L = P!.limits;
  if (P!.billing === "api") {
    return `<section class="block" aria-label="Spend"><h2>Spend today</h2><p class="big">${P!.costTodayUsd != null ? `~$${P!.costTodayUsd.toFixed(2)}` : "—"}</p><p class="muted small">Claude Code's own estimate for your API key.</p></section>`;
  }
  if (P!.billing === "unknown" || (L.fiveHourPct == null && L.sevenDayPct == null)) {
    return P!.connected ? `<section class="block" aria-label="Plan limits"><h2>Plan limits</h2><p class="muted">Shows up after your next Claude message.</p></section>` : "";
  }
  const fiveRight = L.fiveHourPct == null ? "unknown" : `${Math.round(L.fiveHourPct)}%${L.fiveHourResetsAt ? ` · resets ${clock(L.fiveHourResetsAt)}` : ""}`;
  const weekRight = L.sevenDayPct == null ? "unknown" : `${Math.round(L.sevenDayPct)}%${L.sevenDayResetsAt ? ` · resets ${until(L.sevenDayResetsAt)}` : ""}`;
  const forecast = L.fullAt ? `<p class="small ${L.fullAt - Date.now() < 3600_000 ? "warn-text" : "muted"}">At this pace you'll run out around ${clock(L.fullAt)}.</p>` : "";
  return `<section class="block" aria-label="Plan limits"><h2>Plan limits</h2>${bar("Next 5 hours", L.fiveHourPct, fiveRight)}${bar("This week", L.sevenDayPct, weekRight)}${forecast}</section>`;
}

function tipsSection(): string {
  if (!P!.tips.length) return "";
  return `<section class="block" aria-label="Tips"><h2>Tips for right now</h2><ul class="tips">${P!.tips
    .map((t) => `<li><span>${esc(t.text)}</span>${t.action ? ` <button class="link" data-act="tip" data-tip="${t.action}" title="${esc(t.why)}">${esc(t.actionLabel ?? "Do it")}</button>` : ""}</li>`)
    .join("")}</ul></section>`;
}

function promptSection(): string {
  return `<section class="block" aria-label="Prompt">
    <h2><label for="req">What do you want to build next?</label></h2>
    <textarea id="req" rows="3" placeholder="e.g. Add a contact form that emails me"></textarea>
    <div class="actions"><button class="primary" data-act="build">Write my prompt</button></div>
    ${paywalled ? `<p class="small">You've used your free prompts. <a href="#" data-act="upgrade">Go unlimited — ${esc(P!.plan.price)}</a> · <a href="#" data-act="enterLicense">Enter key</a></p>` : ""}
    ${built ? `
      <label class="lbl" for="ptext">Your prompt. Edit anything.</label>
      <textarea id="ptext" class="mono" rows="12"></textarea>
      <div class="actions"><button class="primary" data-act="sendPrompt">Send to Claude</button><button class="secondary" data-act="copyPrompt">Copy</button></div>` : ""}
  </section>`;
}

// ---------- events ----------
function bind(): void {
  document.getElementById("req")?.addEventListener("input", (e) => { vs.request = (e.target as HTMLTextAreaElement).value; persist(); });
  document.getElementById("req")?.addEventListener("keydown", (e) => { const k = e as KeyboardEvent; if (k.key === "Enter" && (k.metaKey || k.ctrlKey)) void buildNow(); });
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
  const r = await call<{ prompt: BuiltPrompt; remaining: number | null } | { paywall: { url: string } } | null>("buildPrompt", { goal: guessGoal(text), request: text, beginner: true, planFirst: true });
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
    case "copyPrompt": await call("copy", { text: promptText }); return flash("Copied");
    case "sendPrompt": return void call("sendToClaude", { text: promptText });
    case "openBuild": return void call("openBuild", { cwd: el.dataset.cwd });
    case "tip": {
      const t = el.dataset.tip;
      if (t === "handoff") { await call("copyHandoff"); return flash("Handoff copied"); }
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
render();
vscode.postMessage({ type: "ready" });
