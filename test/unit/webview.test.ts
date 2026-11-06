/**
 * Runs the REAL bundled sidebar (media/webview.js) in jsdom with a mocked VS Code API,
 * feeds it a state produced by the real engine, and clicks through it.
 */
import * as fs from "fs";
import * as path from "path";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";
import { Engine, UiState } from "../../src/core/engine";
import { GOALS } from "../../src/core/prompts";
import { makeRepo, tmpDir } from "./helpers";

const bundle = path.join(__dirname, "../../media/webview.js");
let state: UiState;
let built: unknown;
const settings = { beginner: true, trusted: true, aiProvider: "none", aiModel: "", apiEnabled: true, apiAddress: "http://127.0.0.1:47821", apiAllowLan: false, notifications: "important", platform: "darwin", home: "~/.buildpilot", pocketUrl: "http://127.0.0.1:47821/pocket", screenshotUri: null };

beforeAll(async () => {
  expect(fs.existsSync(bundle), "run `npm run build` first").toBe(true);
  const home = tmpDir();
  const engine = new Engine({ home, inMemory: true, claudeSettingsFile: path.join(home, "s.json") });
  await engine.start();
  const repo = makeRepo({ "package.json": JSON.stringify({ name: "ui-app", scripts: { test: "node -e 0", dev: "next dev" }, dependencies: { next: "15" } }), "src/a.ts": "1" });
  await engine.openProject(repo);
  engine.loadDemo();
  // hostile content must render as text, never as HTML
  engine.store.run("UPDATE events SET summary = ? WHERE session_id = 'demo-d4e5f6' AND hook_event = 'UserPromptSubmit'", ['<img src=x onerror="window.__xss=1">']);
  state = engine.snapshot();
  built = engine.prompt({ goal: "bugfix", request: "The login button does nothing on mobile Safari" }, state);
  engine.stop();
});

function mount(initial: Record<string, unknown> = {}) {
  const sent: Record<string, unknown>[] = [];
  const dom = new JSDOM(`<!doctype html><html><body><div id="app"></div></body></html>`, { runScripts: "outside-only", url: "https://webview.local/" });
  const w = dom.window as unknown as Window & typeof globalThis & { acquireVsCodeApi: unknown; eval(s: string): unknown; __xss?: number };
  let st: unknown = { tab: "overview", open: {}, goal: "feature", request: "", mustNotChange: "", acceptance: "", planFirst: true, ...initial };
  w.acquireVsCodeApi = () => ({
    getState: () => st,
    setState: (s: unknown) => (st = s),
    postMessage: (m: Record<string, unknown>) => {
      sent.push(m);
      const reply = (result: unknown) => setTimeout(() => w.postMessage({ type: "reply", id: m.id, result }, "*"), 0);
      if (m.type === "goals") reply(GOALS);
      else if (m.type === "buildPrompt") reply(built);
      else if (m.type === "ready") setTimeout(() => w.postMessage({ type: "state", state, settings }, "*"), 0);
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
  return { w, doc, sent, tick, click };
}

describe("sidebar UI (real bundle in jsdom)", () => {
  it("renders the overview with the next step and DEMO banner", async () => {
    const { doc, tick } = mount();
    await tick();
    await tick();
    expect(doc.querySelector(".project")?.textContent).toContain("ui-app");
    expect(doc.querySelector(".next-title")?.textContent?.length).toBeGreaterThan(5);
    expect(doc.querySelector(".demo-banner")?.textContent).toMatch(/DEMO/);
    expect(doc.querySelectorAll(".tab").length).toBe(6);
  });

  it("navigates tabs and shows live sessions with escaped content (no XSS)", async () => {
    const { doc, w, click, tick } = mount();
    await tick();
    await click('[data-tab="sessions"]');
    expect(doc.querySelector(".tab.active")?.getAttribute("data-tab")).toBe("sessions");
    expect(doc.querySelectorAll("article.session").length).toBe(2);
    await click('details[data-key="sess:demo-d4e5f6"] summary');
    expect(doc.body.innerHTML).toContain("&lt;img src=x");
    expect(doc.querySelector("article.session img")).toBeNull();
    expect(w.__xss).toBeUndefined();
    expect(doc.body.textContent).toMatch(/Needs approval/);
  });

  it("Prompt Studio: picks a goal, builds, and copies / starts Claude Code", async () => {
    const { doc, sent, click, tick } = mount({ tab: "prompts" });
    await tick();
    await tick();
    await click('[data-goal-pick="bugfix"]');
    const ta = doc.getElementById("req") as HTMLTextAreaElement;
    ta.value = "The login button does nothing on mobile Safari";
    ta.dispatchEvent(new doc.defaultView!.Event("input"));
    await click('[data-act="build"]');
    await tick();
    const req = sent.find((m) => m.type === "buildPrompt")!;
    expect(req).toMatchObject({ goal: "bugfix", request: "The login button does nothing on mobile Safari" });
    const out = doc.getElementById("ptext") as HTMLTextAreaElement;
    expect(out.value).toContain("# Goal: Fix a bug");
    await click('[data-act="copyPrompt"]');
    expect(sent.find((m) => m.type === "copy")?.text).toBe(out.value);
    await click('[data-act="sendPrompt"]');
    expect(sent.find((m) => m.type === "sendToClaude")?.text).toBe(out.value);
  });

  it("recommendation actions post the right messages", async () => {
    const { doc, sent, click, tick } = mount({ tab: "supervisor" });
    await tick();
    await tick();
    expect(doc.body.textContent).toMatch(/Ready to ship\?/);
    expect(doc.body.textContent).toMatch(/Visual check/);
    await click('[data-act="audit"]');
    expect(sent.some((m) => m.type === "audit")).toBe(true);
    (doc.getElementById("appUrl") as HTMLInputElement).value = "http://localhost:3000";
    await click('[data-act="visualCheck"]');
    expect(sent.find((m) => m.type === "visualCheck")?.url).toBe("http://localhost:3000");
    await click('[data-act="dismiss"]');
    expect(sent.some((m) => m.type === "dismiss")).toBe(true);
  });

  it("Memory: adds a requirement", async () => {
    const { doc, sent, click, tick } = mount({ tab: "memory" });
    await tick();
    await tick();
    (doc.getElementById("newReq") as HTMLInputElement).value = "Users can pay by card";
    (doc.getElementById("newAcc") as HTMLInputElement).value = "test payment succeeds";
    await click('[data-act="addReq"]');
    expect(sent.find((m) => m.type === "addRequirement")).toMatchObject({ title: "Users can pay by card", acceptance: "test payment succeeds" });
  });

  it("Connect: shows Pocket, statusline toggle and integration controls", async () => {
    const { doc, sent, click, tick } = mount({ tab: "connect" });
    await tick();
    await tick();
    expect(doc.body.textContent).toMatch(/Pocket/);
    expect(doc.body.textContent).toMatch(/Exact context % off/);
    await click('[data-act="statuslineOn"]');
    expect(sent.find((m) => m.type === "statusline")?.on).toBe(true);
    await click('[data-act="copyPocketLink"]');
    expect(sent.some((m) => m.type === "copyPocketLink")).toBe(true);
  });

  it("is keyboard and screen-reader accessible", async () => {
    const { doc, tick } = mount();
    await tick();
    await tick();
    // ARIA tabs with roving tabindex, arrow-key navigation
    const tabs = [...doc.querySelectorAll('[role="tab"]')];
    expect(tabs.filter((t) => t.getAttribute("tabindex") === "0").length).toBe(1);
    expect(doc.getElementById("panel")?.getAttribute("aria-labelledby")).toBe("tab-overview");
    (doc.getElementById("tab-overview") as HTMLElement).dispatchEvent(new doc.defaultView!.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await tick();
    expect(doc.activeElement?.id).toBe("tab-sessions");
    expect(doc.getElementById("panel")?.getAttribute("aria-labelledby")).toBe("tab-sessions");
    (doc.getElementById("tab-sessions") as HTMLElement).dispatchEvent(new doc.defaultView!.KeyboardEvent("keydown", { key: "End", bubbles: true }));
    await tick();
    expect(doc.activeElement?.id).toBe("tab-connect");
    // badge meaning is in the accessible name, not only a colored number
    expect(doc.getElementById("tab-sessions")?.getAttribute("aria-label")).toMatch(/waiting for you/);
    // live region announces sessions that need you
    expect(doc.getElementById("live")?.textContent).toMatch(/waiting for you/);
    // every text input/textarea/select has an accessible name
    (doc.getElementById("tab-memory") as HTMLElement).click();
    await tick();
    for (const el of doc.querySelectorAll("input[type=text], textarea, select")) {
      const id = el.getAttribute("id");
      const named = el.getAttribute("aria-label") || (id && doc.querySelector(`label[for="${id}"]`));
      expect(named, `unlabelled ${el.outerHTML.slice(0, 80)}`).toBeTruthy();
    }
  });

  it("shows metric tiles with full spoken labels that link to where you act", async () => {
    const { doc, sent, tick } = mount();
    await tick();
    await tick();
    const tiles = [...doc.querySelectorAll("button.metric")];
    expect(tiles.length).toBe(6);
    for (const t of tiles) expect(t.getAttribute("aria-label")!.length).toBeGreaterThan(40);
    (tiles.find((t) => t.textContent!.includes("Tests")) as HTMLElement).click();
    await tick();
    expect(doc.querySelector(".tab.active")?.getAttribute("data-tab")).toBe("supervisor");
    void sent;
  });
});

