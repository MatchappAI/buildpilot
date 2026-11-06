// Builds standalone HTML previews of the real webview bundle for each scenario, and screenshots them with headless Chrome.
// Usage: node test/ui/make-preview.mjs [outDir]   (default: test/ui/shots)
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
const dir = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(dir, "../..");
const out = path.resolve(process.argv[2] ?? path.join(dir, "shots"));
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(dir)) if (/^preview-.*\.html$/.test(f)) fs.rmSync(path.join(dir, f));
const fx = JSON.parse(fs.readFileSync(path.join(dir, process.env.BP_FIXTURE ?? "fixture.json"), "utf8"));
const chrome = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].find((c) => fs.existsSync(c));
for (const [name, sc] of Object.entries(fx.scenarios)) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="file://${root}/media/webview.css"></head><body><div id="app"></div>
<script>
const SC = ${JSON.stringify(sc)}; const FX = { state: ${JSON.stringify(fx.state)}, built: ${JSON.stringify(fx.built)} };
let st = { request: SC.request || "" };
window.acquireVsCodeApi = () => ({ getState: () => st, setState: (s) => { st = s; }, postMessage: (m) => {
  const reply = (result) => setTimeout(() => window.postMessage({ type: "reply", id: m.id, result }, "*"), 0);
  if (m.type === "ready") { window.postMessage({ type: "state", state: FX.state, page: SC.page, settings: { trusted: true } }, "*"); if (SC.buildFirst) setTimeout(() => document.querySelector('[data-act=build]')?.click(), 100); }
  else if (m.type === "buildPrompt") reply(SC.paywall ? { paywall: { url: "https://buy.stripe.com/x" } } : { prompt: FX.built, remaining: SC.page.plan.freeLeft });
  else reply(null);
}});
</script><script src="file://${root}/media/webview.js"></script></body></html>`;
  const file = path.join(out, `${name}.html`);
  fs.writeFileSync(file, html);
  if (chrome) {
    const prof = fs.mkdtempSync(path.join(os.tmpdir(), "bp-chr-"));
    try {
      execFileSync(chrome, ["--headless=new", "--disable-gpu", "--allow-file-access-from-files", `--user-data-dir=${prof}`, "--hide-scrollbars", "--window-size=760,1700", "--virtual-time-budget=1500", `--screenshot=${path.join(out, `${name}.png`)}`, `file://${file}`], { stdio: "ignore", timeout: 30000 });
    } catch {
      /* screenshot best-effort */
    }
  }
}
console.log(`previews written to ${out}${chrome ? " (with screenshots)" : " (no Chrome found: HTML only)"}`);
