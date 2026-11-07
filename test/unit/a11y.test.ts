/**
 * Automated accessibility audit (axe-core, WCAG 2.1 A/AA rules) of the REAL page bundle in every main state.
 * Color contrast is measured separately (jsdom has no layout); see the contrast test below.
 */
import * as fs from "fs";
import * as path from "path";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";
import { Engine, UiState } from "../../src/core/engine";
import { pageData, PageData } from "../../src/core/page";
import { makeRepo, tmpDir } from "./helpers";

const bundle = fs.readFileSync(path.join(__dirname, "../../media/webview.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "../../src/webview/style.css"), "utf8");
const axeSrc = fs.readFileSync(path.join(__dirname, "../../node_modules/axe-core/axe.min.js"), "utf8");
let state: UiState;
let base: PageData;
const now = Date.now();

beforeAll(async () => {
  const home = tmpDir();
  const engine = new Engine({ home, inMemory: true, claudeSettingsFile: path.join(home, "s.json") });
  await engine.start();
  await engine.openProject(makeRepo({ "package.json": "{}", "a.txt": "1" }));
  state = engine.snapshot();
  base = pageData(engine, state, now, {});
  engine.stop();
});

const b = (o: Partial<PageData["builds"][number]>): PageData["builds"][number] => ({ id: "s1", folder: "shop", cwd: "/p/shop", status: "running", word: "working", reason: "", task: "Add checkout", contextPct: 40, lastEventAt: now - 60_000, needsYou: false, next: null, share: 20, ...o });

async function audit(p: PageData, opts: { standalone?: boolean; expand?: boolean; theme?: string } = {}) {
  const dom = new JSDOM(`<!doctype html><html lang="en"><head><title>BuildPilot</title><style>${css}</style></head><body><div id="app"></div></body></html>`, { runScripts: "outside-only", url: "https://webview.local/" });
  const w = dom.window as unknown as Window & typeof globalThis & { acquireVsCodeApi: unknown; eval(s: string): unknown; axe: { run(ctx: unknown, o: unknown): Promise<{ violations: { id: string; impact: string; help: string; nodes: { html: string }[] }[] }> } };
  w.acquireVsCodeApi = () => ({ getState: () => ({}), setState: () => {}, postMessage: (m: Record<string, unknown>) => { if (m.type === "ready") setTimeout(() => w.postMessage({ type: "state", state, page: p, settings: { trusted: true, standalone: !!opts.standalone, theme: opts.theme } }, "*"), 0); else if (m.id) setTimeout(() => w.postMessage({ type: "reply", id: m.id, result: null }, "*"), 0); } });
  w.eval(bundle);
  await new Promise((r) => setTimeout(r, 60));
  if (opts.expand) { (w.document.querySelector('[data-act="toggleBuild"]') as HTMLElement | null)?.click(); await new Promise((r) => setTimeout(r, 30)); }
  w.eval(axeSrc);
  const r = await w.axe.run(w.document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] }, rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  return r.violations.map((v) => `${v.impact} ${v.id}: ${v.help} → ${v.nodes[0]?.html.slice(0, 120)}`);
}

describe("accessibility (axe, WCAG 2.1 AA)", () => {
  it("first run has no violations", async () => {
    expect(await audit({ ...base, connected: false })).toEqual([]);
  });

  it("busy page: heads-up, groups, errors, Codex, tips, limits — no violations", async () => {
    const p: PageData = { ...base, connected: true, billing: "plan", needs: 1, working: 2,
      builds: [b({ id: "a", name: "checkout", needsYou: true, status: "awaiting_approval", waitingFor: "Run: npm i stripe" }), b({ id: "b2", now: "Running npm test", nowSince: now - 120_000, errors1h: 2, lastErrors: ["Error: x"] }), b({ id: "c", folder: "api", agent: "codex", now: "Running pytest" })],
      limits: { fiveHourPct: 85, fiveHourResetsAt: now + 3600_000, sevenDayPct: 40, sevenDayResetsAt: now + 3 * 86400_000, fullAt: now + 40 * 60_000, forecastLocked: false },
      tips: [{ key: "memory", text: "x's chat is 85% full.", why: "y", action: "startFresh", actionLabel: "Start fresh chat", cwd: "/p" }] };
    expect(await audit(p)).toEqual([]);
    expect(await audit(p, { standalone: true, expand: true })).toEqual([]);
    expect(await audit(p, { standalone: true, expand: true, theme: "match" })).toEqual([]);
  });
});

describe("color contrast (WCAG AA 4.5:1 for text)", () => {
  const lum = (h: string) => { const [r, g, bb] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r! + 0.7152 * g! + 0.0722 * bb!; };
  const ratio = (a: string, c: string) => { const [x, y] = [lum(a), lum(c)].sort((m, n) => n - m); return (x! + 0.05) / (y! + 0.05); };
  const token = (n: string) => css.match(new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6})`))![1]!;
  it("every text color passes on white and on the page background", () => {
    for (const t of ["ink", "muted", "accent", "ok", "warn", "bad"]) {
      expect(ratio(token(t), "#ffffff"), `${t} on white`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(token(t), token("bg")), `${t} on bg`).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio("#ffffff", token("accent")), "button text").toBeGreaterThanOrEqual(4.5);
  });
  it("the dark page (standalone window) passes too", () => {
    const rule = css.match(/body\.match\.sa \{([^}]*)\}/)![1]!;
    const dark = (n: string) => rule.match(new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6})`))![1]!;
    for (const t of ["ink", "muted", "accent", "ok", "warn", "bad"]) {
      expect(ratio(dark(t), dark("bg")), `${t} on dark bg`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(dark(t), dark("card")), `${t} on dark card`).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(dark("accent-ink"), dark("accent")), "dark button text").toBeGreaterThanOrEqual(4.5);
  });
  it("no text smaller than 12px", () => {
    for (const m of css.matchAll(/font-size:\s*(\d+)px/g)) expect(Number(m[1]), m[0]).toBeGreaterThanOrEqual(12);
  });
});
