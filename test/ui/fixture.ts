// Produces a realistic UI state from the REAL engine (demo sessions clearly labelled) for visual QA.
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { Engine } from "../../src/core/engine";
import { GOALS } from "../../src/core/prompts";

(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bp-ui-home-"));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "invoice-app-"));
  const w = (f: string, c: string) => { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), c); };
  w("package.json", JSON.stringify({ name: "invoice-app", description: "Freelancers create invoices and send them by Gmail.", scripts: { dev: "next dev", build: "node -e 0", test: "node -e \"console.error('1 failing: sends invoice email'); process.exit(1)\"" }, dependencies: { next: "15", react: "19", googleapis: "1", stripe: "1" } }));
  for (let i = 0; i < 14; i++) w(`src/feature${i}.ts`, `export const f${i} = ${i};\n// TODO: handle errors\n`);
  w("src/gmail.ts", "export async function send() {}\n");
  w("src/gmail.test.ts", "test('send', () => {})\n");
  w(".env.example", "GMAIL_CLIENT_ID=\nGMAIL_CLIENT_SECRET=\nSTRIPE_SECRET_KEY=\n");
  w(".env", "GMAIL_CLIENT_ID=x\n");
  fs.mkdirSync(path.join(repo, "node_modules"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["-c", "user.name=a", "-c", "user.email=a@a", "commit", "-qm", "Add invoice PDF export"], { cwd: repo });
  w("src/invoice.ts", "export const x = 2;\n");
  const engine = new Engine({ home, inMemory: true, claudeSettingsFile: path.join(home, "settings.json") });
  await engine.start();
  await engine.openProject(repo);
  engine.setNote("goal", "Help freelancers send professional invoices in under a minute.");
  engine.addRequirement("Create an invoice", "invoice saved with line items and total");
  engine.addRequirement("Send invoice via Gmail", "recipient receives email with PDF attached");
  engine.addRequirement("Accept card payments", "");
  engine.updateRequirement(engine.requirements()[0]!.id, { status: "done" });
  engine.updateRequirement(engine.requirements()[1]!.id, { status: "in_progress" });
  engine.addDecision("Use Gmail API, not SMTP", "OAuth refresh tokens; avoids app passwords");
  await engine.runScript("test");
  engine.loadDemo();
  fs.mkdirSync(path.join(home, "status"), { recursive: true });
  fs.writeFileSync(path.join(home, "status", "demo-a1b2c3.json"), JSON.stringify({ session_id: "demo-a1b2c3", cost: { total_cost_usd: 2.41 }, context_window: { used_percentage: 83, context_window_size: 200000, total_input_tokens: 166000 }, rate_limits: { five_hour: { used_percentage: 42 } } }));
  const pid = engine.currentProject!.id;
  const note = (k: string, v: unknown) => engine.store.run("INSERT INTO notes (project_id, key, value, updated_at) VALUES (?, ?, ?, ?)", [pid, k, JSON.stringify(v), Date.now()]);
  note("audit", { ranAt: Date.now() - 600000, tool: "npm audit", ok: true, counts: { critical: 0, high: 1, moderate: 3, low: 0, info: 0, total: 4 }, top: [{ name: "next", severity: "high", fixAvailable: true, title: "Authorization bypass in middleware" }], error: null });
  note("visual", { url: "http://localhost:3000", checkedAt: Date.now() - 120000, reachable: true, status: 500, title: "Invoices", looksBlank: false, errorText: "Unhandled Runtime Error TypeError: Cannot read properties of undefined (reading 'total')", screenshot: null, note: "The page loaded but shows an error." });
  if (process.argv.includes("--pocket")) {
    const { IntegrationApi, loadOrCreateToken } = await import("../../src/core/api");
    const token = loadOrCreateToken(home);
    const api = new IntegrationApi(engine, { port: 47950, host: "127.0.0.1", token });
    await api.start();
    const shot = process.argv[process.argv.indexOf("--pocket") + 1]!;
    const { execFile } = await import("child_process");
    const prof = fs.mkdtempSync(path.join(os.tmpdir(), "bp-chr-"));
    // async: the API server in this same process must keep answering the page's requests
    await new Promise<void>((resolve) => execFile("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--hide-scrollbars", "--window-size=500,900", "--timeout=5000", `--screenshot=${shot}`, `http://127.0.0.1:47950/pocket#t=${token}`], { timeout: 30000 }, () => resolve()));
    await api.stop();
  }
  const st = engine.snapshot();
  const built = engine.prompt({ goal: "integration", request: "Make my Gmail integration work perfectly" }, st);
  fs.writeFileSync(path.join(__dirname, "fixture.json"), JSON.stringify({ state: st, goals: GOALS, built, handoff: engine.handoff(st) }));
  engine.stop();
  console.log("fixture written");
})();
