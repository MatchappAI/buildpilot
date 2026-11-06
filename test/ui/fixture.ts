// Produces realistic one-page scenarios from the REAL engine + page data, for visual QA and persona reviews.
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { Engine } from "../../src/core/engine";
import { pageData, PageData } from "../../src/core/page";
import { PRO_POINTS } from "../../src/core/license";

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
  const built = engine.prompt({ goal: "feature", request: "Add a contact form that emails me", planFirst: true }, st);
  engine.stop();

  const b = (o: Partial<PageData["builds"][number]>): PageData["builds"][number] => ({ share: null, id: "s", folder: "invoice-app", cwd: repo, status: "running", word: "working", reason: "", task: "Adding the invoice PDF export", contextPct: 31, lastEventAt: now - 90_000, needsYou: false, next: null, ...o });
  const plan = (five: number, week: number, fullAt: number | null) => ({ fiveHourPct: five, fiveHourResetsAt: now + 2.2 * 3600_000, sevenDayPct: week, sevenDayResetsAt: now + 3.5 * 86400_000, fullAt, forecastLocked: false });
  const free = { pro: false, licensed: false, trialDaysLeft: null, sellable: true, freeLeft: 20, price: "$9/mo", points: PRO_POINTS };
  const S = (o: Partial<PageData>): PageData => ({ ...base, connected: true, billing: "plan", limits: plan(22, 14, null), tips: [], plan: { ...free, pro: true, trialDaysLeft: 11, freeLeft: null }, ...o });

  const scenarios: Record<string, { page: PageData; paywall?: boolean; request?: string; buildFirst?: boolean }> = {
    "1-first-run": { page: { ...base, connected: false } },
    "2-one-build": { page: S({ builds: [b({})], working: 1, plan: { ...free, pro: true, trialDaysLeft: 2, trialEndsAt: now + 2 * 86400_000, freeLeft: null } }) },
    "3-parallel-needs-you": {
      page: S({
        builds: [
          b({ id: "a", folder: "invoice-app-checkout", status: "awaiting_approval", word: "needs approval", reason: "Wants to run: npm install stripe", needsYou: true, contextPct: 46, share: 22 }),
          b({ id: "b", folder: "invoice-app", share: 17 }),
          b({ id: "c", folder: "landing-page", task: "Writing the pricing section", contextPct: 84, share: 61 }),
        ],
        needs: 1,
        working: 2,
        side: [{ name: "invoice-app-checkout", dir: repo + "-checkout", branch: "bp/checkout", changed: 4, unsaved: 2, commits: 1 }],
        limits: plan(58, 31, null),
        tips: [{ key: "memory", text: "landing-page's chat is 84% full, so Claude will start forgetting details. Start a fresh chat that picks up where it left off.", why: "", action: "startFresh", actionLabel: "Start fresh chat", cwd: repo }],
      }),
    },
    "4-near-limit": {
      page: S({ builds: [b({ share: 64 }), b({ id: "q", folder: "landing-page", task: "Writing the pricing section", share: 36 })], working: 2, limits: plan(88, 61, now + 35 * 60_000), tips: [{ key: "limit", text: "You\'ve used 88% of your 5-hour limit (back at " + new Date(now + 2.2 * 3600_000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + "). invoice-app is using 64% of your usage today; pause it if it can wait (press Esc in its terminal; your files are kept).", why: "", action: "pause", actionLabel: "Open invoice-app", cwd: repo }] }),
    },
    "5-prompt-written": { page: S({ builds: [b({})], working: 1, plan: { ...free, freeLeft: 14 }, limits: { ...plan(22, 14, null), forecastLocked: true } }), request: "Add a contact form that emails me", buildFirst: true },
    "6-paywalled": { page: S({ builds: [b({})], working: 1, plan: { ...free, freeLeft: 0 }, limits: { ...plan(22, 14, null), forecastLocked: true } }), request: "Add dark mode", buildFirst: true, paywall: true },
    "7-api-billing": { page: S({ builds: [b({ costUsd: 4.12 }), b({ id: "k", folder: "landing-page", task: "Writing the pricing section", costUsd: 2.72 })], working: 2, billing: "api", costTodayUsd: 6.84, limits: { fiveHourPct: null, fiveHourResetsAt: null, sevenDayPct: null, sevenDayResetsAt: null, fullAt: null, forecastLocked: false } }) },
    "8-pro": { page: S({ builds: [b({}), b({ id: "z", folder: "invoice-app-dark-mode", task: "Theme tokens" })], working: 2, plan: { ...free, pro: true, licensed: true, freeLeft: null } }) },
  };
  fs.writeFileSync(path.join(__dirname, "fixture.json"), JSON.stringify({ state: st, built, scenarios }));
  console.log(`fixture written: ${Object.keys(scenarios).length} scenarios`);
})();
