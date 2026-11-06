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
  const m = e.data as { type: string; id?: number; result?: unknown; state?: UiState; page?: PageData; settings?: { trusted?: boolean; theme?: string } };
  if (m.type === "reply" && m.id) {
    waiting.get(m.id)?.(m.result);
    waiting.delete(m.id);
  } else if (m.type === "state") {
    S = m.state ?? null;
    P = m.page ?? null;
    trusted = m.settings?.trusted ?? true;
    theme = m.settings?.theme === "match" ? "match" : "white";
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
  document.body.classList.toggle("match", theme === "match");
  app.innerHTML = `
  <main class="page">
    <header class="head">
      <h1>BuildPilot</h1>
      ${planPill()}
    </header>
    ${trialNotice()}
    ${!trusted ? `<p class="note">This folder isn't trusted, so BuildPilot can look but won't change anything.</p>` : ""}
    ${!P.connected ? connectCard() : `${buildsSection()}${limitsSection()}${tipsSection()}${promptSection()}`}
    <footer class="foot">
      <a href="#" data-act="more" title="Dependency check, app check, save points and undo, handoff, phone alerts and more">Advanced tools</a> · <a href="#" data-act="toggleTheme">${theme === "match" ? "White page" : "Match my theme"}</a>${P.connected ? ` · <a href="#" data-act="disconnect">Disconnect</a>` : ""}
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

function planPill(): string {
  const p = P!.plan;
  if (p.licensed) return `<span class="pill">Pro</span>`;
  if (!p.sellable) return "";
  if (p.trialDaysLeft != null) return `<span class="pill soft" title="Every Pro feature is on during your trial. After it, watching builds, limits, tips, 20 prompts and 2 builds at once stay free; the run-out forecast and per-build usage need Pro.">Pro trial · ${p.trialDaysLeft} day${p.trialDaysLeft === 1 ? "" : "s"} left</span>`;
  return "";
}

function trialNotice(): string {
  const p = P!.plan;
  if (!p.sellable || p.licensed || p.trialDaysLeft == null || p.trialDaysLeft > 3) return "";
  const day = p.trialEndsAt ? new Date(p.trialEndsAt).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }) : "soon";
  return `<p class="note">Your Pro trial ends ${esc(day)}. After that the run-out forecast and per-build usage turn off, and you can run 2 builds at once. Everything else stays free. No card is on file and nothing is charged unless you choose Pro. <a href="#" data-act="upgrade">Keep Pro — ${esc(p.price)}</a></p>`;
}

function connectCard(): string {
  return `<section class="card connect">
    <h2>Connect Claude Code</h2>
    <p>BuildPilot adds a few lines to your Claude Code settings so it can see your builds, how full each chat is, and your plan limits. Your settings are backed up first, nothing leaves this computer, and you can disconnect anytime.</p>
    <div class="actions"><button class="primary" data-act="connectAll">Connect</button><button class="link" data-act="showConnectChanges">See exactly what changes</button></div>
  </section>`;
}

const STATUS_WORD: Record<string, string> = { running: "Working", idle: "Idle", blocked: "Waiting for your answer", awaiting_approval: "Waiting for your OK", completed: "Done", failed: "Stopped with an error", unknown: "Quiet" };

function buildsSection(): string {
  const b = P!.builds;
  const summary = !b.length
    ? "No builds running"
    : `${b.length} build${b.length === 1 ? "" : "s"}${P!.working ? ` · ${P!.working} working` : ""}${P!.needs ? ` · <b class="need">${P!.needs} need${P!.needs === 1 ? "s" : ""} you</b>` : ""}`;
  return `<section class="block" aria-label="Builds">
    <div class="row-head"><h2 class="status">${summary}</h2><button class="secondary" data-act="newBuild" title="Starts Claude in a separate copy of this project, so two builds can't undo each other's work">+ New build</button></div>
    ${b.length ? `<ul class="builds">${b
      .map((x) => `<li class="${x.needsYou ? "needs" : ""}">
        <span class="dot dot-${x.status}" aria-hidden="true"></span>
        <div class="b-main"><div class="b-name">${esc(x.folder)}</div><div class="b-sub" title="${esc(x.cwd)}">${x.needsYou ? `Waiting ${ago(x.lastEventAt).replace(" ago", "")} · ${esc(x.reason || STATUS_WORD[x.status])}` : `${esc(x.task || STATUS_WORD[x.status] || x.word)} · ${ago(x.lastEventAt)}`}</div></div>
        <div class="b-meta">${x.contextPct != null ? `<span class="mem tone-${tone(x.contextPct)}" title="How much of this chat Claude can still keep in mind. Near 100% it starts forgetting details.">chat ${Math.round(x.contextPct)}% full</span>` : ""}${x.costUsd != null ? `<span class="share" title="Claude Code's own estimate for this build today">~$${x.costUsd.toFixed(2)} today</span>` : x.share != null ? `<span class="share" title="This build's share of all your Claude usage today (Claude Code's own estimate)">${x.share}% of your usage today</span>` : ""}</div>
        <button class="${x.needsYou ? "primary" : "link"}" data-act="openBuild" data-cwd="${esc(x.cwd)}" title="${x.needsYou ? "Opens its terminal. Nothing is approved until you approve it there." : "Opens its terminal"}">${x.needsYou ? "Review in terminal" : "Open terminal"}</button>
      </li>`)
      .join("")}</ul>` : `<p class="muted">Type <code>claude</code> in a terminal, or press <b>+ New build</b>. Builds show up here as soon as Claude does something.</p>`}
  </section>`;
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
    return `<section class="block" aria-label="Spend"><h2>Spend today</h2><p class="big">${P!.costTodayUsd != null ? `~$${P!.costTodayUsd.toFixed(2)}` : "—"}</p><p class="muted small">Claude Code's own estimate for your API key, across all builds today.</p></section>`;
  }
  if (P!.billing === "unknown" || (L.fiveHourPct == null && L.sevenDayPct == null)) {
    return `<section class="block" aria-label="Plan limits"><h2>Plan limits</h2><p class="muted">Shows up after your next message to Claude.</p></section>`;
  }
  const fiveRight = L.fiveHourPct == null ? "unknown" : `${Math.round(L.fiveHourPct)}% used${L.fiveHourResetsAt ? ` · back to 0% at ${clock(L.fiveHourResetsAt)}` : ""}`;
  const weekRight = L.sevenDayPct == null ? "unknown" : `${Math.round(L.sevenDayPct)}% used${L.sevenDayResetsAt ? ` · resets ${weekday(L.sevenDayResetsAt)}` : ""}`;
  let forecast = "";
  if (L.fullAt) {
    const gap = L.fiveHourResetsAt && L.fiveHourResetsAt > L.fullAt ? Math.round((L.fiveHourResetsAt - L.fullAt) / 60_000) : 0;
    const urgent = L.fullAt - Date.now() < 3600_000;
    forecast = `<p class="forecast ${urgent ? "urgent" : ""}" title="${L.basisMin ? `Based on your usage over the last ${L.basisMin} min.` : ""}">At this pace you'll run out around <b>${clock(L.fullAt)}</b>${gap > 0 ? `, then wait ${gap >= 60 ? `${Math.floor(gap / 60)} h ${gap % 60} min` : `${gap} min`} until it's back` : ""}. <span class="muted small">Estimate${L.basisMin ? ` from your last ${L.basisMin} min` : ""}.</span></p>`;
  } else if (L.forecastLocked && P!.plan.sellable) {
    forecast = `<p class="locked">At this pace you'll run out around <span class="blur" aria-hidden="true">0:00 PM</span> <a href="#" data-act="upgrade" class="lock-link">Unlock with Pro</a></p>`;
  }
  return `<section class="block" aria-label="Plan limits"><h2>Plan limits</h2>${forecast}${bar("Next 5 hours", L.fiveHourPct, fiveRight)}${bar("This week", L.sevenDayPct, weekRight)}<p class="muted tiny">From Claude Code. The 5-hour window refills on its own; Claude pauses if it reaches 100%.</p></section>`;
}

function tipsSection(): string {
  if (!P!.tips.length) return "";
  return `<section class="block" aria-label="Tips"><h2>Tips for right now</h2><ul class="tips">${P!.tips
    .map((t) => `<li><span>${esc(t.text)}</span>${t.action ? `<button class="secondary small-btn" data-act="tip" data-tip="${t.action}" ${t.cwd ? `data-cwd="${esc(t.cwd)}"` : ""} title="${esc(t.why)}">${esc(t.actionLabel ?? "Do it")}</button>` : ""}</li>`)
    .join("")}</ul></section>`;
}

function paywallCard(): string {
  const p = P!.plan;
  return `<div class="paywall" role="status">
    <b>You've used your ${FREE} free prompts.</b>
    <ul>${p.points.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    <div class="actions"><button class="primary" data-act="upgrade">Get Pro — ${esc(p.price)}</button><button class="link" data-act="enterLicense">I have a license key</button></div>
    <p class="muted tiny">Separate from your Claude plan. Cancel anytime. Watching builds, limits and tips stays free. The checkout link includes a random id only so your payment can be matched to your key.</p>
  </div>`;
}

function promptSection(): string {
  const p = P!.plan;
  const counter = !p.pro && p.freeLeft != null && !paywalled ? `<span class="muted small" title="A prompt only counts when you start or copy it">${p.freeLeft} of ${FREE} free prompts left</span>` : "";
  const folder = S?.facts?.name ?? S?.project?.name ?? "this project";
  return `<section class="block" aria-label="Prompt">
    <h2><label for="req">What do you want to build next?</label></h2>
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
    case "copyPrompt": await call("copy", { text: promptText }); void call("promptUsed"); return flash("Copied");
    case "useInOpen": void call("promptUsed"); await call("useInOpen", { text: promptText }); return flash("Copied. Paste it into Claude (Cmd/Ctrl+V)");
    case "sendPrompt": void call("promptUsed"); return void call("sendToClaude", { text: promptText });
    case "openBuild": return void call("openBuild", { cwd: el.dataset.cwd });
    case "tip": {
      const t = el.dataset.tip;
      if (t === "startFresh") return void call("startFresh", { cwd: el.dataset.cwd });
      if (t === "setupUndo") return void call("setupUndo");
      if (t === "pause") { await call("openBuild", { cwd: el.dataset.cwd }); return flash("Press Esc in that terminal to pause Claude"); }
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
