import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { RepoFacts } from "./analyzer";
import { run } from "./git";
import { clip } from "./redact";
import { Requirement } from "./types";

// ---------------------------------------------------------------------------
// Dependency vulnerability audit (approved action; npm audit needs network to the npm registry)
// ---------------------------------------------------------------------------

export interface AuditResult {
  ranAt: number;
  tool: "npm audit" | "pip-audit";
  ok: boolean; // the tool ran and produced parseable output
  counts: { critical: number; high: number; moderate: number; low: number; info: number; total: number };
  top: { name: string; severity: string; fixAvailable: boolean; title: string }[];
  error: string | null;
}

const ZERO = { critical: 0, high: 0, moderate: 0, low: 0, info: 0, total: 0 };

export function parseNpmAudit(json: string, ranAt = Date.now()): AuditResult {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(json);
  } catch {
    return { ranAt, tool: "npm audit", ok: false, counts: { ...ZERO }, top: [], error: "npm audit output was not JSON" };
  }
  if (d.error) return { ranAt, tool: "npm audit", ok: false, counts: { ...ZERO }, top: [], error: clip(String((d.error as { summary?: string }).summary ?? JSON.stringify(d.error)), 300) };
  const meta = ((d.metadata as Record<string, unknown> | undefined)?.vulnerabilities ?? {}) as Record<string, number>;
  const counts = { critical: meta.critical ?? 0, high: meta.high ?? 0, moderate: meta.moderate ?? 0, low: meta.low ?? 0, info: meta.info ?? 0, total: meta.total ?? 0 };
  const vulns = (d.vulnerabilities ?? {}) as Record<string, { severity?: string; fixAvailable?: unknown; via?: unknown[] }>;
  const order = ["critical", "high", "moderate", "low", "info"];
  const top = Object.entries(vulns)
    .map(([name, v]) => {
      const via = (v.via ?? []).find((x) => typeof x === "object" && x !== null) as { title?: string } | undefined;
      return { name: clip(name, 80), severity: v.severity ?? "unknown", fixAvailable: !!v.fixAvailable, title: clip(via?.title ?? "via a dependency", 140) };
    })
    .sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
    .slice(0, 10);
  return { ranAt, tool: "npm audit", ok: true, counts, top, error: null };
}

export function parsePipAudit(json: string, ranAt = Date.now()): AuditResult {
  try {
    const d = JSON.parse(json) as { dependencies?: { name: string; vulns?: { id: string; fix_versions?: string[] }[] }[] };
    const top: AuditResult["top"] = [];
    let total = 0;
    for (const dep of d.dependencies ?? []) for (const v of dep.vulns ?? []) {
      total++;
      if (top.length < 10) top.push({ name: clip(dep.name, 80), severity: "unknown", fixAvailable: (v.fix_versions ?? []).length > 0, title: clip(v.id, 60) });
    }
    return { ranAt, tool: "pip-audit", ok: true, counts: { ...ZERO, total }, top, error: null };
  } catch {
    return { ranAt, tool: "pip-audit", ok: false, counts: { ...ZERO }, top: [], error: "pip-audit output was not JSON" };
  }
}

export async function runAudit(f: RepoFacts): Promise<AuditResult> {
  const ranAt = Date.now();
  if (fs.existsSync(path.join(f.root, "package-lock.json")) || (f.packageManager === "npm" && fs.existsSync(path.join(f.root, "package.json")))) {
    const bin = process.platform === "win32" ? "npm.cmd" : "npm";
    const r = await run(bin, ["audit", "--json"], f.root, { timeoutMs: 120_000, maxBuffer: 64 * 1024 * 1024 });
    // npm audit exits 1 when vulnerabilities exist; that's still a successful audit.
    if (!r.stdout.trim()) return { ranAt, tool: "npm audit", ok: false, counts: { ...ZERO }, top: [], error: clip(r.stderr || "npm audit produced no output (offline, or no lockfile?)", 300) };
    return parseNpmAudit(r.stdout, ranAt);
  }
  if (f.languages.includes("Python")) {
    const r = await run("pip-audit", ["-f", "json", "-r", "requirements.txt"], f.root, { timeoutMs: 180_000 });
    if (r.code !== 0 && !r.stdout.trim()) return { ranAt, tool: "pip-audit", ok: false, counts: { ...ZERO }, top: [], error: "pip-audit isn't installed or failed. Install it with `pip install pip-audit`." };
    return parsePipAudit(r.stdout, ranAt);
  }
  return { ranAt, tool: "npm audit", ok: false, counts: { ...ZERO }, top: [], error: f.packageManager && f.packageManager !== "npm" ? `Audits for ${f.packageManager} aren't supported yet. Run its audit command yourself.` : "No supported dependency manifest found." };
}

// ---------------------------------------------------------------------------
// Requirements drift: recent prompts that don't map to any tracked requirement
// ---------------------------------------------------------------------------

const STOP = new Set("make with that this from have what when where which should would could please into your them they then than also just like want need some more most only very really work works working sure fix add update change file files code test tests page using used thing things build".split(" "));

export function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !STOP.has(w))
      .map((w) => (w.endsWith("s") && w.length > 4 ? w.slice(0, -1) : w)),
  );
}

export function detectDrift(prompts: string[], requirements: Requirement[]): string[] {
  const active = requirements.filter((r) => r.status !== "dropped");
  if (active.length === 0) return [];
  const reqWords = new Set<string>();
  for (const r of active) for (const w of keywords(`${r.title} ${r.acceptance}`)) reqWords.add(w);
  const out: string[] = [];
  for (const p of prompts) {
    const ks = keywords(p);
    if (ks.size < 2) continue; // too short to judge ("continue", "yes")
    if (![...ks].some((w) => reqWords.has(w))) out.push(p);
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------
// Visual QA v1: is the app reachable, what does it show, screenshot via an installed Chromium browser
// ---------------------------------------------------------------------------

export function detectAppUrl(f: RepoFacts, override?: string): { url: string | null; basis: string } {
  if (override?.trim()) return { url: override.trim(), basis: "your setting" };
  for (const s of ["dev", "start", "serve", "preview"]) {
    const cmd = f.scripts[s];
    if (!cmd) continue;
    const m = /(?:--port[ =]|-p\s+|PORT=)(\d{2,5})/.exec(cmd);
    if (m) return { url: `http://localhost:${m[1]}`, basis: `\`${s}\` script` };
  }
  const fw = f.frameworks;
  if (fw.includes("Next.js")) return { url: "http://localhost:3000", basis: "Next.js default" };
  if (fw.includes("Vite")) return { url: "http://localhost:5173", basis: "Vite default" };
  if (fw.includes("Express") || fw.includes("React")) return { url: "http://localhost:3000", basis: "common default" };
  if (fw.includes("Django")) return { url: "http://localhost:8000", basis: "Django default" };
  if (fw.includes("Flask")) return { url: "http://localhost:5000", basis: "Flask default" };
  if (fw.includes("Streamlit")) return { url: "http://localhost:8501", basis: "Streamlit default" };
  return { url: null, basis: "not detected" };
}

export function findBrowser(): string | null {
  const c: string[] =
    process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"]
      : process.platform === "win32"
        ? [`${process.env["PROGRAMFILES"]}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env["PROGRAMFILES(X86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`, `${process.env["LOCALAPPDATA"]}\\Google\\Chrome\\Application\\chrome.exe`]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];
  return c.find((p) => p && fs.existsSync(p)) ?? null;
}

export interface VisualCheck {
  url: string;
  checkedAt: number;
  reachable: boolean;
  status: number | null;
  title: string | null;
  looksBlank: boolean;
  errorText: string | null; // e.g. framework error overlay text
  screenshot: string | null; // absolute path
  note: string;
}

/** Only loopback URLs are allowed: this is for the user's own running app. */
export function isLocalUrl(u: string): boolean {
  try {
    const x = new URL(u);
    return (x.protocol === "http:" || x.protocol === "https:") && ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(x.hostname);
  } catch {
    return false;
  }
}

export async function visualCheck(url: string, outDir: string, browser = findBrowser()): Promise<VisualCheck> {
  const checkedAt = Date.now();
  const base: VisualCheck = { url, checkedAt, reachable: false, status: null, title: null, looksBlank: false, errorText: null, screenshot: null, note: "" };
  if (!isLocalUrl(url)) return { ...base, note: "Only local addresses (localhost) can be checked." };
  let html = "";
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "follow" });
    base.status = res.status;
    base.reachable = true;
    html = (await res.text()).slice(0, 400_000);
  } catch (e) {
    return { ...base, note: `Not reachable: ${(e as Error).message}. Is the app running?` };
  }
  base.title = clip(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? "", 120) || null;
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  base.looksBlank = text.length < 20 && !/<div id="(root|app|__next)"/i.test(html);
  const err = /(Unhandled Runtime Error|Internal Server Error|Application error|Cannot GET \/|Module not found|SyntaxError|TypeError)[^<]{0,160}/.exec(text);
  base.errorText = err ? clip(err[0], 200) : base.status && base.status >= 500 ? `HTTP ${base.status}` : null;
  if (browser) {
    fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
    const shot = path.join(outDir, `shot-${checkedAt}.png`);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "bp-chrome-"));
    const r = await run(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars", `--user-data-dir=${profile}`, "--window-size=1280,800", "--virtual-time-budget=4000", `--screenshot=${shot}`, url], outDir, { timeoutMs: 45_000 });
    fs.rmSync(profile, { recursive: true, force: true });
    if (fs.existsSync(shot)) base.screenshot = shot;
    else base.note = `Screenshot failed (${clip(r.stderr, 120)}).`;
  } else base.note = "No Chrome/Edge/Chromium found, so the reachability check ran without a screenshot.";
  if (!base.note) base.note = base.errorText ? "The page loaded but shows an error." : base.looksBlank ? "The page loaded but looks empty (it may render with JavaScript; check the screenshot)." : "The page loaded.";
  return base;
}
