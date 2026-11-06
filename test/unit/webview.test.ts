/**
 * Runs the REAL bundled page (media/webview.js) in jsdom with a mocked VS Code API,
 * feeds it state + page data produced by the real engine, and clicks through it.
 */
import * as fs from "fs";
import * as path from "path";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";
import { Engine, UiState } from "../../src/core/engine";
import { pageData, PageData } from "../../src/core/page";
import { makeRepo, tmpDir } from "./helpers";

const bundle = path.join(__dirname, "../../media/webview.js");
const ext = fs.readFileSync(path.join(__dirname, "../../src/extension/extension.ts"), "utf8");
const handled = new Set([...ext.matchAll(/case "([a-zA-Z]+)":/g)].map((m) => m[1]));
let state: UiState;
let page: PageData;
let built: unknown;

const now = Date.now();
const session = (o: Partial<PageData["builds"][number]>): PageData["builds"][number] => ({ id: "s1", folder: "shop", cwd: "/p/shop", status: "running", word: "working", reason: "", task: "Adding checkout", contextPct: 34, lastEventAt: now - 60_000, needsYou: false, next: null, share: null, ...o });
const freePlan = { pro: false, licensed: false, trialDaysLeft: null, sellable: true, freeLeft: 3, price: "$9/mo", points: ["See when you'll run out, and what's using your limit", "Unlimited builds side by side", "Unlimited prompts"] };
const full = (o: Partial<PageData> = {}): PageData => ({
  ...page,
  connected: true,
  builds: [session({}), session({ id: "s2", folder: "blog", cwd: "/p/blog", status: "awaiting_approval", word: "needs approval", reason: "Wants to run npm install", needsYou: true, contextPct: 88 })],
  needs: 1,
  working: 1,
  billing: "plan",
  limits: { fiveHourPct: 72, fiveHourResetsAt: now + 2 * 3600_000, sevenDayPct: 30, sevenDayResetsAt: now + 3 * 86400_000, fullAt: now + 40 * 60_000, forecastLocked: false },
  tips: [{ key: "memory", text: "blog's chat is 88% full, so Claude will start forgetting details.", why: "x", action: "startFresh", actionLabel: "Start fresh", cwd: "/p/blog" }],
  plan: freePlan,
  side: [{ name: "shop-checkout", dir: "/p/shop-checkout", branch: "bp/checkout", changed: 3, unsaved: 1, commits: 0 }, { name: "shop-empty", dir: "/p/shop-empty", branch: "bp/empty", changed: 0, unsaved: 0, commits: 0 }],
  ...o,
});

beforeAll(async () => {
  expect(fs.existsSync(bundle), "run `npm run build` first").toBe(true);
  const home = tmpDir();
  const engine = new Engine({ home, inMemory: true, claudeSettingsFile: path.join(home, "s.json") });
  await engine.start();
  const repo = makeRepo({ "package.json": JSON.stringify({ name: "ui-app", scripts: { test: "node -e 0" } }), "src/a.ts": "1" });
  await engine.openProject(repo);
  state = engine.snapshot();
  page = pageData(engine, state, now, {});
  built = engine.prompt({ goal: "bugfix", request: "The login button does nothing on mobile Safari" }, state);
  engine.stop();
});

function mount(p: PageData, opts: { paywall?: boolean; trusted?: boolean } = {}) {
  const sent: Record<string, unknown>[] = [];
  const dom = new JSDOM(`<!doctype html><html><body><div id="app"></div></body></html>`, { runScripts: "outside-only", url: "https://webview.local/" });
  const w = dom.window as unknown as Window & typeof globalThis & { acquireVsCodeApi: unknown; eval(s: string): unknown; __xss?: number };
  let st: unknown = {};
  w.acquireVsCodeApi = () => ({
    getState: () => st,
    setState: (s: unknown) => (st = s),
    postMessage: (m: Record<string, unknown>) => {
      sent.push(m);
      const reply = (result: unknown) => setTimeout(() => w.postMessage({ type: "reply", id: m.id, result }, "*"), 0);
      if (m.type === "buildPrompt") reply(opts.paywall ? { paywall: { url: "https://buy.stripe.com/x" } } : { prompt: built, remaining: 3 });
      else if (m.type === "ready") setTimeout(() => w.postMessage({ type: "state", state, page: p, settings: { trusted: opts.trusted ?? true } }, "*"), 0);
      else if (m.id) reply(null);
    },
  });
  w.eval(fs.readFileSync(bundle, "utf8"));
  const doc = w.document;
  const tick = () => new Promise((r) => setTimeout(r, 30));
  const click = async (sel: string) => {
    const el = doc.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`no element ${sel}`);
    el.click();
    await tick();
  };
  const type = (id: string, v: string) => {
    const ta = doc.getElementById(id) as HTMLTextAreaElement;
    ta.value = v;
    ta.dispatchEvent(new doc.defaultView!.Event("input"));
  };
  return { w, doc, sent, tick, click, type };
}

describe("one-page UI (real bundle in jsdom)", () => {
  it("is one page: no tabs, no sidebar chrome, white background", async () => {
    const { doc, tick } = mount(full());
    await tick();
    await tick();
    expect(doc.querySelectorAll("[role=tab], .tabs").length).toBe(0);
    expect(doc.querySelector("h1")?.textContent).toBe("BuildPilot");
    const css = fs.readFileSync(path.join(__dirname, "../../src/webview/style.css"), "utf8");
    expect(css).toMatch(/--bg:\s*#fafafa/);
    expect(css.slice(0, css.indexOf("body.match")).match(/--vscode-/g)).toBeNull(); // white unless the user picks "match"
  });

  it("not connected: one Connect card that says what changes, nothing else to figure out", async () => {
    const { doc, sent, tick, click } = mount({ ...page, connected: false });
    await tick();
    await tick();
    expect(doc.querySelector(".card.connect")?.textContent).toMatch(/adds a few lines to your Claude Code settings/);
    expect(doc.getElementById("req")).toBeNull();
    await click('[data-act="showConnectChanges"]');
    expect(sent.some((m) => m.type === "showConnectChanges")).toBe(true);
    await click('[data-act="connectAll"]');
    expect(sent.some((m) => m.type === "connectAll")).toBe(true);
  });

  it("builds: needs-you first with a Go button, memory shown in plain words, content escaped", async () => {
    const { doc, w, sent, tick, click } = mount(full({ builds: [session({ folder: '<img src=x onerror="window.__xss=1">', needsYou: true, status: "blocked" })], needs: 1 }));
    await tick();
    await tick();
    expect(doc.querySelector(".status")?.textContent).toMatch(/1 needs you/);
    expect(doc.body.innerHTML).toContain("&lt;img src=x");
    expect(w.__xss).toBeUndefined();
    expect(doc.querySelector(".mem")?.textContent).toBe("chat 34% full");
    expect(doc.querySelector('[data-act="openBuild"]')?.textContent).toBe("Review in terminal");
    await click('[data-act="openBuild"]');
    expect(sent.find((m) => m.type === "openBuild")?.cwd).toBe("/p/shop");
  });

  it("plan users see limits + reset + forecast, never dollars", async () => {
    const { doc, tick } = mount(full());
    await tick();
    await tick();
    const t = doc.body.textContent ?? "";
    expect(t).toMatch(/Next 5 hours/);
    expect(t).toMatch(/72% used · back to 0% at/);
    expect(t).toMatch(/then wait 1 h 20 min until it's back/);
    expect(t).toMatch(/This week/);
    expect(t).toMatch(/At this pace you'll run out around/);
    expect(t).not.toMatch(/\$\d/);
  });

  it("API users see today's spend instead of plan bars", async () => {
    const { doc, tick } = mount(full({ billing: "api", costTodayUsd: 4.2, limits: { fiveHourPct: null, fiveHourResetsAt: null, sevenDayPct: null, sevenDayResetsAt: null, fullAt: null, forecastLocked: false } }));
    await tick();
    await tick();
    expect(doc.body.textContent).toMatch(/~\$4\.20/);
    expect(doc.body.textContent).not.toMatch(/Next 5 hours/);
  });

  it("side builds: review and merge a build with changes; remove an empty one", async () => {
    const { doc, sent, tick, click } = mount(full());
    await tick();
    await tick();
    expect(doc.querySelector(".side")?.textContent).toMatch(/3 files changed · not saved yet/);
    await click('[data-act="reviewBuild"]');
    await click('[data-act="mergeBuild"]');
    await click('[data-act="removeBuild"]');
    expect(sent.find((m) => m.type === "mergeBuild")).toMatchObject({ dir: "/p/shop-checkout", branch: "bp/checkout" });
    expect(sent.find((m) => m.type === "removeBuild")).toMatchObject({ dir: "/p/shop-empty" });
    expect(sent.some((m) => m.type === "reviewBuild")).toBe(true);
  });

  it("tips have one clear action", async () => {
    const { doc, sent, tick, click } = mount(full());
    await tick();
    await tick();
    expect(doc.querySelectorAll(".tips li").length).toBe(1);
    await click('[data-act="tip"]');
    expect(sent.find((m) => m.type === "startFresh")?.cwd).toBe("/p/blog");
  });

  it("prompt: plain words in, goal picked automatically, then Send to Claude / Copy", async () => {
    const { doc, sent, tick, click, type } = mount(full());
    await tick();
    await tick();
    type("req", "The login button is broken on mobile");
    await click('[data-act="build"]');
    await tick();
    expect(sent.find((m) => m.type === "buildPrompt")).toMatchObject({ goal: "bugfix", request: "The login button is broken on mobile" });
    const out = doc.getElementById("ptext") as HTMLTextAreaElement;
    expect(out.value.length).toBeGreaterThan(200);
    expect(doc.querySelector(".summary")?.textContent).toMatch(/This asks Claude to The login button is broken on mobile/);
    expect(sent.find((m) => m.type === "buildPrompt")?.defer).toBe(true);
    expect(sent.some((m) => m.type === "promptUsed")).toBe(false); // not counted until used
    await click('[data-act="sendPrompt"]');
    expect(sent.find((m) => m.type === "sendToClaude")?.text).toBe(out.value);
    expect(sent.filter((m) => m.type === "promptUsed").length).toBe(1);
    await click('[data-act="copyPrompt"]');
    expect(doc.getElementById("flash")?.textContent).toBe("Copied");
  });

  it("empty prompt explains instead of doing nothing", async () => {
    const { doc, sent, tick, click } = mount(full());
    await tick();
    await tick();
    await click('[data-act="build"]');
    expect(sent.some((m) => m.type === "buildPrompt")).toBe(false);
    expect(doc.getElementById("flash")?.textContent).toMatch(/Type what you want/);
  });

  it("free limit: one quiet line with Upgrade + Enter key", async () => {
    const { doc, sent, tick, click, type } = mount(full(), { paywall: true });
    await tick();
    await tick();
    type("req", "Add a footer");
    await click('[data-act="build"]');
    await tick();
    expect(doc.getElementById("ptext")).toBeNull();
    expect(doc.body.textContent).toMatch(/You've used your 20 free prompts\./);
    expect(doc.querySelector(".paywall")?.textContent).toMatch(/Unlimited builds side by side/);
    expect(doc.querySelector(".paywall")?.textContent).toMatch(/Cancel anytime/);
    expect((doc.getElementById("req") as HTMLTextAreaElement).value).toBe("Add a footer"); // typed text kept
    await click('[data-act="upgrade"]');
    await click('[data-act="enterLicense"]');
    expect(sent.some((m) => m.type === "upgrade") && sent.some((m) => m.type === "enterLicense")).toBe(true);
  });

  it("free prompts counter is visible from the start; trial shows days left; locked forecast shows a quiet Pro link", async () => {
    const { doc, tick } = mount(full({ plan: { ...freePlan, freeLeft: 17 }, limits: { ...full().limits, fullAt: null, forecastLocked: true } }));
    await tick();
    await tick();
    expect(doc.body.textContent).toMatch(/17 of 20 free prompts left/);
    expect(doc.querySelector(".locked")?.textContent).toMatch(/At this pace you'll run out around .* Unlock with Pro/);
    const t = mount(full({ plan: { ...freePlan, pro: true, trialDaysLeft: 9, freeLeft: null } }));
    await t.tick();
    await t.tick();
    expect(t.doc.querySelector(".pill")?.textContent).toBe("Pro trial · 9 days left");
  });

  it("Pro shows a small pill and no counters", async () => {
    const { doc, tick } = mount(full({ plan: { ...freePlan, pro: true, licensed: true, freeLeft: null } }));
    await tick();
    await tick();
    expect(doc.querySelector(".pill")?.textContent).toBe("Pro");
    expect(doc.body.textContent).not.toMatch(/free prompt/);
  });

  it("every button posts a message the extension actually handles", async () => {
    for (const p of [full(), { ...page, connected: false }, full({ tips: [{ key: "nogit", text: "x", why: "y", action: "setupUndo", actionLabel: "Turn on undo" }] })]) {
      const { doc, sent, tick, type } = mount(p);
      await tick();
      await tick();
      if (doc.getElementById("req")) {
        type("req", "Add a footer");
        (doc.querySelector('[data-act="build"]') as HTMLElement).click();
        await tick();
      }
      const clicked = new Set<string>();
      for (let guard = 0; guard < 40; guard++) {
        const next = [...doc.querySelectorAll("[data-act]")].find((el) => !clicked.has(`${el.getAttribute("data-act")}:${el.getAttribute("data-tip") ?? ""}`));
        if (!next) break;
        clicked.add(`${next.getAttribute("data-act")}:${next.getAttribute("data-tip") ?? ""}`);
        (next as HTMLElement).click();
        await tick();
      }
      for (const m of sent) expect(handled.has(String(m.type)), `"${m.type}" has no handler in extension.ts`).toBe(true);
    }
  });

  it("accessible: every field labelled, meters expose values, live region exists", async () => {
    const { doc, tick } = mount(full());
    await tick();
    await tick();
    for (const el of doc.querySelectorAll("textarea, input")) {
      const id = el.getAttribute("id");
      expect(el.getAttribute("aria-label") || (id && doc.querySelector(`label[for="${id}"]`)), el.outerHTML.slice(0, 60)).toBeTruthy();
    }
    expect(doc.querySelector('[role=progressbar][aria-valuenow="72"]')).not.toBeNull();
    expect(doc.getElementById("live")?.getAttribute("aria-live")).toBe("polite");
  });

  it("live updates keep what you typed and your focus", async () => {
    const { doc, w, tick, type } = mount(full());
    await tick();
    await tick();
    type("req", "half-typed idea");
    (doc.getElementById("req") as HTMLTextAreaElement).focus();
    w.postMessage({ type: "state", state, page: full({ working: 2 }), settings: { trusted: true } }, "*");
    await tick();
    expect((doc.getElementById("req") as HTMLTextAreaElement).value).toBe("half-typed idea");
    expect(doc.activeElement?.id).toBe("req");
  });
});
