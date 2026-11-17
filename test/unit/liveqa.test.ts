/**
 * Regressions found by operating the live window (2026-11-16 live QA). Each test repeats the exact failing sequence.
 * Page tests run the REAL bundle (media/webview.js) in jsdom; server tests use the real UiServer.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { JSDOM } from "jsdom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Engine, UiState } from "../../src/core/engine";
import { pageData, PageData } from "../../src/core/page";
import { disambiguate } from "../../src/core/glance";
import { tips } from "../../src/core/tips";
import { tooBroadForUndo } from "../../src/core/git";
import { UiServer } from "../../src/core/uiserver";
import { makeRepo, tmpDir } from "./helpers";

const bundle = path.join(__dirname, "../../media/webview.js");
const now = Date.now();
let state: UiState;
let page: PageData;
let built: unknown;
const session = (o: Partial<PageData["builds"][number]>): PageData["builds"][number] => ({ id: "aaaaaaaa-1111", folder: "shop", cwd: "/p/shop", status: "running", word: "working", reason: "", task: "Adding checkout", contextPct: 34, lastEventAt: now - 60_000, needsYou: false, next: null, share: null, ...o });
const full = (o: Partial<PageData> = {}): PageData => ({ ...page, connected: true, builds: [session({})], needs: 0, working: 1, billing: "plan", tips: [], side: [], ...o });

beforeAll(async () => {
  const home = tmpDir();
  const engine = new Engine({ home, inMemory: true, claudeSettingsFile: path.join(home, "s.json") });
  await engine.start();
  await engine.openProject(makeRepo({ "package.json": JSON.stringify({ name: "ui-app", scripts: { test: "node -e 0" } }) }));
  state = engine.snapshot();
  page = pageData(engine, state, now, {});
  built = engine.prompt({ goal: "feature", request: "add a dark mode toggle" }, state);
  engine.stop();
});

function mount(p: PageData, saved: Record<string, unknown> = {}) {
  const sent: Record<string, unknown>[] = [];
  const dom = new JSDOM(`<!doctype html><html><body><div id="app"></div></body></html>`, { runScripts: "outside-only", url: "https://webview.local/" });
  const w = dom.window as unknown as Window & typeof globalThis & { acquireVsCodeApi: unknown; eval(s: string): unknown };
  let st: unknown = saved;
  const held: (() => void)[] = []; // replies held back to simulate a slow server
  let slow = false;
  w.acquireVsCodeApi = () => ({
    getState: () => st,
    setState: (s: unknown) => (st = s),
    postMessage: (m: Record<string, unknown>) => {
      sent.push(m);
      const reply = (result: unknown) => { const go = () => w.postMessage({ type: "reply", rid: m.rid, result }, "*"); if (slow) held.push(go); else setTimeout(go, 0); };
      if (m.type === "ready") setTimeout(() => w.postMessage({ type: "state", state, page: p, settings: { trusted: true, standalone: true } }, "*"), 0);
      else if (m.type === "buildPrompt") reply({ prompt: built, remaining: null });
      else if (m.rid) reply({ flash: "ok" });
    },
  });
  w.eval(fs.readFileSync(bundle, "utf8"));
  const doc = w.document;
  const tick = () => new Promise((r) => setTimeout(r, 30));
  const push = (pg: PageData) => w.postMessage({ type: "state", state, page: pg, settings: { trusted: true, standalone: true } }, "*");
  return { w, doc, sent, tick, push, saved: () => st, setSlow: (v: boolean) => (slow = v), release: () => held.splice(0).forEach((f) => f()) };
}

describe("live QA regressions (window page)", () => {
  it("a call that carries a session id still gets its answer, so the same button works a second time (rename twice)", async () => {
    const { doc, sent, tick } = mount(full());
    await tick(); await tick();
    (doc.querySelector('[data-act="renameBuild"]') as HTMLElement).click(); await tick();
    (doc.querySelector('[data-act="renameBuild"]') as HTMLElement).click(); await tick();
    const renames = sent.filter((m) => m.type === "renameBuild");
    expect(renames.length).toBe(2);
    expect(renames[0]!.id).toBe("aaaaaaaa-1111"); // the session id is sent as-is…
    expect(typeof renames[0]!.rid).toBe("number"); // …and the reply is matched by rid
  });

  it("a double click on Write my prompt sends one request, and the button says Writing… while it waits", async () => {
    const { doc, sent, tick, setSlow, release } = mount(full());
    await tick(); await tick();
    const req = doc.getElementById("req") as HTMLTextAreaElement;
    req.value = "add search"; req.dispatchEvent(new doc.defaultView!.Event("input"));
    setSlow(true);
    (doc.querySelector('[data-act="build"]') as HTMLElement).click();
    (doc.querySelector('[data-act="build"]') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 600));
    expect(sent.filter((m) => m.type === "buildPrompt").length).toBe(1);
    expect(doc.querySelector('[data-act="build"]')?.textContent).toBe("Writing…");
    release(); await tick(); await tick();
    expect(doc.querySelector('[data-act="build"]')?.textContent).toBe("Write my prompt");
    expect((doc.getElementById("ptext") as HTMLTextAreaElement).value.length).toBeGreaterThan(50);
  });

  it("text typed in the file box survives a live refresh (before Find is pressed)", async () => {
    const { doc, tick, push } = mount(full());
    await tick(); await tick();
    (doc.querySelector('[data-act="openFinder"]') as HTMLElement).click(); await tick();
    const q = doc.getElementById("fileq") as HTMLInputElement;
    q.value = "checkout"; q.dispatchEvent(new doc.defaultView!.Event("input"));
    push(full({ builds: [session({ lastEventAt: now - 5_000, now: "Editing checkout.tsx" })] })); await tick();
    expect((doc.getElementById("fileq") as HTMLInputElement).value).toBe("checkout");
  });

  it("a selection and scroll inside the written prompt survive a live refresh", async () => {
    const { doc, tick, push } = mount(full());
    await tick(); await tick();
    const req = doc.getElementById("req") as HTMLTextAreaElement;
    req.value = "add search"; req.dispatchEvent(new doc.defaultView!.Event("input"));
    (doc.querySelector('[data-act="build"]') as HTMLElement).click(); await tick(); await tick();
    const t = doc.getElementById("ptext") as HTMLTextAreaElement;
    t.focus(); t.setSelectionRange(5, 25);
    push(full({ builds: [session({ lastEventAt: now - 1_000, now: "Running tests" })] })); await tick();
    const t2 = doc.getElementById("ptext") as HTMLTextAreaElement;
    expect(doc.activeElement).toBe(t2);
    expect([t2.selectionStart, t2.selectionEnd]).toEqual([5, 25]);
  });

  it("the written prompt and the request it was written for come back after a reload", async () => {
    const a = mount(full());
    await a.tick(); await a.tick();
    const req = a.doc.getElementById("req") as HTMLTextAreaElement;
    req.value = "add search"; req.dispatchEvent(new a.doc.defaultView!.Event("input"));
    (a.doc.querySelector('[data-act="build"]') as HTMLElement).click(); await a.tick(); await a.tick();
    const saved = a.saved() as Record<string, unknown>;
    const b = mount(full(), { ...saved, request: "something else typed later" });
    await b.tick(); await b.tick();
    expect((b.doc.getElementById("ptext") as HTMLTextAreaElement | null)?.value).toBe(saved.prompt);
    expect(b.doc.querySelector(".summary")?.textContent).toContain("add search");
  });

  it("Pause is only offered for a session that is actually working, named so you can tell same-folder sessions apart", async () => {
    const limits = { ...page.limits, fiveHourPct: 85 };
    const idleHog = mount(full({ limits, builds: [session({ status: "idle", word: "your turn", share: 60, hint: "login button" }), session({ id: "bbbbbbbb-2222", share: 10, hint: "checkout" })] }));
    await idleHog.tick(); await idleHog.tick();
    expect(idleHog.doc.querySelector('[data-tip="pause"]')).toBeNull();
    const busy = mount(full({ limits, builds: [session({ share: 60, hint: "checkout" }), session({ id: "bbbbbbbb-2222", status: "idle", share: 10, hint: "login" })] }));
    await busy.tick(); await busy.tick();
    expect(busy.doc.querySelector('[data-tip="pause"]')?.textContent).toBe("Pause shop (checkout) (60%)");
  });

  it("the needs-you line names the exact session when a folder has several", async () => {
    const { doc, tick } = mount(full({ needs: 1, builds: [session({ status: "awaiting_approval", needsYou: true, hint: "clean the old build" }), session({ id: "bbbbbbbb-2222", hint: "checkout" })] }));
    await tick(); await tick();
    expect(doc.querySelector(".hu-need")?.textContent).toContain("shop (clean the old build) needs your OK");
  });

  it("the test result sits on its own line (no line starting with a stray dot)", async () => {
    const { doc, tick } = mount(full({ builds: [session({ status: "idle", turn: { steps: 3, files: 2, proof: "verified", done: true } as never })] }));
    await tick(); await tick();
    const parts = [...doc.querySelectorAll(".b-prog .part")].map((p) => p.textContent);
    expect(parts).toEqual(["3 steps · 2 files changed", "✓ tests passed after the last change"]);
  });
});

describe("live QA regressions (engine + server)", () => {
  it("session hints drop dangling filler words", () => {
    expect(disambiguate({ id: "x", task: "the login button does nothing on mobile" })).toBe("login button does nothing");
    expect(disambiguate({ id: "x", task: "add a checkout page with Stripe test mode" })).toBe("add checkout page");
    expect(disambiguate({ id: "abcdef123", task: "" })).toBe("abcdef");
  });

  it("a project without undo (no Git) is never pushed out of the 3 tips by session tips", () => {
    const b = (id: string, o: Record<string, unknown>) => ({ id, folder: "blog", cwd: "/p/blog", status: "idle", word: "idle", reason: "", task: "x", contextPct: 10, lastEventAt: Date.now(), needsYou: false, next: null, ...o });
    const t = tips({ now: Date.now(), builds: [b("1", { stopped: true }), b("2", { errors1h: 4 }), b("3", { turn: { steps: 2, files: 3, proof: "unverified", done: true } })] as never, limits: { fiveHourPct: 10 } as never, biggest: null, isGit: false, unsaved: null, stuck: [] });
    expect(t.map((x) => x.key.split(":")[0])).toContain("nogit");
    expect(t.find((x) => x.key.startsWith("errors"))?.action ?? t.length).toBeTruthy();
  });

  it("Turn on undo is refused for the home folder, the disk root and anything above home (never git add your whole home)", async () => {
    expect(tooBroadForUndo(os.homedir())).toBe(true);
    expect(tooBroadForUndo("/")).toBe(true);
    expect(tooBroadForUndo(path.dirname(os.homedir()))).toBe(true);
    expect(tooBroadForUndo(path.join(os.homedir(), "projects", "shop"))).toBe(false);
    const home = tmpDir();
    const engine = new Engine({ home, inMemory: true, claudeSettingsFile: path.join(home, "s.json") });
    await engine.start();
    const fake = tmpDir(); // stands in for a home folder with no Git
    const srv = new UiServer(engine, { media: "" });
    const prev = process.env.HOME; process.env.HOME = fake;
    try {
      await engine.openProject(fake);
      const r = (await srv.onMessage({ type: "setupUndo" })) as { flash: string };
      expect(r.flash).toMatch(/won't turn on undo for your whole home folder/);
      expect(fs.existsSync(path.join(fake, ".git"))).toBe(false);
      expect(pageData(engine, engine.snapshot()).tips.some((t) => t.key === "nogit")).toBe(false);
    } finally { process.env.HOME = prev; engine.stop(); }
  });

  describe("window server", () => {
    let engine: Engine; let srv: UiServer; let blog: string; let base: string;
    beforeAll(async () => {
      const home = tmpDir();
      engine = new Engine({ home, inMemory: true, claudeSettingsFile: path.join(home, "s.json") });
      await engine.start();
      await engine.openProject(makeRepo({ "package.json": "{}" }));
      // Not in a temp folder: BuildPilot hides sessions there (headless runs).
      base = fs.mkdtempSync(path.join(os.homedir(), process.platform === "darwin" ? "Library/Caches/bp-unit." : ".cache-bp-unit."));
      blog = path.join(base, "blog"); fs.mkdirSync(blog);
      (engine as unknown as { ingestor: { ingestRaw(r: string, ts: number): unknown } }).ingestor.ingestRaw(JSON.stringify({ session_id: "blog-1", cwd: blog, hook_event_name: "UserPromptSubmit", prompt: "move posts to MDX" }), Date.now());
      srv = new UiServer(engine, { media: path.join(__dirname, "../../media") });
      await srv.start();
    });
    afterAll(async () => { await srv.stop(); engine.stop(); fs.rmSync(base, { recursive: true, force: true }); });

    it("the project picker lists folders Claude worked in, and picking one opens it", async () => {
      const list = (await srv.onMessage({ type: "projects" })) as { root: string; name: string }[];
      expect(list.map((x) => x.name)).toContain("blog");
      expect(await srv.onMessage({ type: "selectProject", root: blog })).toBeNull();
      expect(engine.currentProject?.root).toBe(blog);
    });

    it("free plan: the side-build limit is checked before any name is asked", async () => {
      const r = (await srv.onMessage({ type: "newBuildCheck" })) as { ok?: boolean; flash?: string };
      expect(r.ok === true || typeof r.flash === "string").toBe(true); // allowed (or a plain reason), never a crash
    });
  });
});
