// Produces realistic one-page scenarios from the REAL engine + page data, for visual QA and persona reviews.
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { Engine } from "../../src/core/engine";
import { pageData, PageData } from "../../src/core/page";

(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bp-ui-home-"));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "invoice-app-"));
  const w = (f: string, c: string) => { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), c); };
  w("package.json", JSON.stringify({ name: "invoice-app", scripts: { dev: "next dev", test: "node -e 0" }, dependencies: { next: "15" } }));
  w("src/a.ts", "export const a = 1;\n");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["-c", "user.name=a", "-c", "user.email=a@a", "commit", "-qm", "init"], { cwd: repo });
  const engine = new Engine({ home, inMemory: true, claudeSettingsFile: path.join(home, "settings.json") });
  await engine.start();
  await engine.openProject(repo);
  const st = engine.snapshot();
  const now = Date.now();
  const base = pageData(engine, st, now, {});
  const built = engine.prompt({ goal: "feature", request: "Add a contact form that emails me" }, st);
  engine.stop();

  const b = (o: Partial<PageData["builds"][number]>): PageData["builds"][number] => ({ id: "s", folder: "invoice-app", cwd: repo, status: "running", word: "working", reason: "", task: "Adding the invoice PDF export", contextPct: 31, lastEventAt: now - 90_000, needsYou: false, next: null, ...o });
  const plan = (five: number, week: number, fullAt: number | null) => ({ fiveHourPct: five, fiveHourResetsAt: now + 2.2 * 3600_000, sevenDayPct: week, sevenDayResetsAt: now + 3.5 * 86400_000, fullAt });
  const S = (o: Partial<PageData>): PageData => ({ ...base, connected: true, billing: "plan", limits: plan(22, 14, null), tips: [], plan: { pro: false, freeLeft: 20, price: "$9/mo" }, ...o });

  const scenarios: Record<string, { page: PageData; paywall?: boolean; request?: string; buildFirst?: boolean }> = {
    "1-first-run": { page: { ...base, connected: false } },
    "2-one-build": { page: S({ builds: [b({})], working: 1 }) },
    "3-parallel-needs-you": {
      page: S({
        builds: [
          b({ id: "a", folder: "invoice-app-checkout", status: "awaiting_approval", word: "needs approval", reason: "Wants to run: npm install stripe", needsYou: true, contextPct: 46 }),
          b({ id: "b", folder: "invoice-app" }),
          b({ id: "c", folder: "landing-page", task: "Writing the pricing section", contextPct: 84 }),
        ],
        needs: 1,
        working: 2,
        limits: plan(58, 31, null),
        tips: [{ key: "memory", text: "landing-page's memory is 84% full. Start a fresh build and paste the handoff.", why: "", action: "handoff", actionLabel: "Copy handoff" }],
      }),
    },
    "4-near-limit": {
      page: S({ builds: [b({})], working: 1, limits: plan(88, 61, now + 35 * 60_000), tips: [{ key: "limit", text: "You'll hit your 5-hour limit around " + new Date(now + 35 * 60_000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + ". Finish the most important task first.", why: "", action: null }] }),
    },
    "5-prompt-written": { page: S({ builds: [b({})], working: 1, plan: { pro: false, freeLeft: 4, price: "$9/mo" } }), request: "Add a contact form that emails me", buildFirst: true },
    "6-paywalled": { page: S({ builds: [b({})], working: 1, plan: { pro: false, freeLeft: 0, price: "$9/mo" } }), request: "Add dark mode", buildFirst: true, paywall: true },
    "7-api-billing": { page: S({ builds: [b({})], working: 1, billing: "api", costTodayUsd: 6.84, limits: { fiveHourPct: null, fiveHourResetsAt: null, sevenDayPct: null, sevenDayResetsAt: null, fullAt: null } }) },
    "8-pro": { page: S({ builds: [b({}), b({ id: "z", folder: "invoice-app-dark-mode", task: "Theme tokens" })], working: 2, plan: { pro: true, freeLeft: null, price: "$9/mo" } }) },
  };
  fs.writeFileSync(path.join(__dirname, "fixture.json"), JSON.stringify({ state: st, built, scenarios }));
  console.log(`fixture written: ${Object.keys(scenarios).length} scenarios`);
})();
