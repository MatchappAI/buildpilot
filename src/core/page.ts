import * as fs from "fs";
import * as path from "path";
import type { Engine, UiState } from "./engine";
import { widgetData, WidgetSession } from "./glance";
import { LiveStatus, readLiveStatus } from "./hooks";
import { FREE_PROMPTS, gate, PRICE } from "./license";
import { Tip, tips } from "./tips";
import { shouldAsk } from "./counts";

/**
 * Everything the one-page BuildPilot view shows. Pure data, no vscode imports.
 * Each number is observed (from Claude Code's status line) or null = unknown. Never guessed.
 */
export type Billing = "plan" | "api" | "unknown";
export interface Limits {
  fiveHourPct: number | null;
  fiveHourResetsAt: number | null;
  sevenDayPct: number | null;
  sevenDayResetsAt: number | null;
  /** When the 5-hour limit will be hit at the current pace; null = not enough data or it resets first. */
  fullAt: number | null;
}
export interface PageData {
  connected: boolean;
  builds: WidgetSession[];
  needs: number;
  working: number;
  billing: Billing;
  limits: Limits;
  /** Claude Code's own list-price estimate, summed over today's builds. Only meaningful for API billing. */
  costTodayUsd: number | null;
  tips: Tip[];
  plan: { pro: boolean; freeLeft: number | null; price: string };
  /** Ask once whether to share 4 anonymous counts. */
  askCounts: boolean;
}

const DAY = 86_400_000;

/** Recent status-line snapshots across every folder (limits are account-wide). */
export function recentStatuses(home: string, now: number, maxAgeMs = 6 * 3600_000): LiveStatus[] {
  const dir = path.join(home, "status");
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: LiveStatus[] = [];
  for (const f of files) {
    const l = readLiveStatus(f.replace(/\.json$/, ""), home);
    if (l && now - l.updatedAt < maxAgeMs) out.push(l);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function billingOf(statuses: LiveStatus[]): Billing {
  if (!statuses.length) return "unknown";
  return statuses.some((s) => s.fiveHourPct != null || s.sevenDayPct != null) ? "plan" : "api";
}

/** Take the newest reading (limits are account-wide, so the latest session is the truth). */
function pickLimit(st: LiveStatus[], pct: "fiveHourPct" | "sevenDayPct", at: "fiveHourResetsAt" | "sevenDayResetsAt", now: number) {
  const s = st.find((x) => x[pct] != null && (x[at] == null || x[at]! > now));
  return { pct: s?.[pct] ?? null, resetsAt: s?.[at] ?? null };
}

// ---------- forecast ----------
interface SampleFile { resetsAt: number | null; samples: [number, number][] }
const samplesPath = (home: string) => path.join(home, "limit-samples.json");

/** Remember 5-hour usage over time (one window at a time) so we can forecast when it runs out. */
export function recordLimitSample(home: string, pct: number | null, resetsAt: number | null, now: number): SampleFile {
  let f: SampleFile = { resetsAt: null, samples: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(samplesPath(home), "utf8")) as SampleFile;
    if (Array.isArray(raw.samples)) f = raw;
  } catch {
    /* first run */
  }
  if (pct == null) return f;
  // A new window (different reset time, or usage dropped) starts a fresh series.
  const last = f.samples[f.samples.length - 1];
  if ((resetsAt != null && f.resetsAt != null && Math.abs(resetsAt - f.resetsAt) > 60_000) || (last && pct < last[1] - 1)) f = { resetsAt, samples: [] };
  f.resetsAt = resetsAt ?? f.resetsAt;
  if (!last || now - last[0] >= 60_000 || pct !== last[1]) f.samples.push([now, pct]);
  f.samples = f.samples.slice(-120);
  try {
    fs.writeFileSync(samplesPath(home), JSON.stringify(f));
  } catch {
    /* read-only home: forecast just stays unknown */
  }
  return f;
}

/** Least-squares line through the samples. Needs ≥3 points over ≥10 minutes and rising usage. */
export function forecastFullAt(f: SampleFile, now: number): number | null {
  const s = f.samples;
  if (s.length < 3 || s[s.length - 1]![0] - s[0]![0] < 10 * 60_000) return null;
  const n = s.length;
  const mx = s.reduce((a, [t]) => a + t, 0) / n;
  const my = s.reduce((a, [, p]) => a + p, 0) / n;
  let num = 0;
  let den = 0;
  for (const [t, p] of s) {
    num += (t - mx) * (p - my);
    den += (t - mx) ** 2;
  }
  const slope = den ? num / den : 0; // % per ms
  const lastPct = s[n - 1]![1];
  if (slope <= 0 || lastPct >= 100) return lastPct >= 100 ? now : null;
  const at = now + (100 - lastPct) / slope;
  if (f.resetsAt && at >= f.resetsAt) return null; // resets before it runs out
  return at;
}

// ---------- assemble ----------
export function pageData(engine: Engine, st: UiState | null, now = Date.now(), env: NodeJS.ProcessEnv = process.env): PageData {
  const w = widgetData(engine, now);
  const statuses = recentStatuses(engine.home, now);
  const billing = billingOf(recentStatuses(engine.home, now, 7 * DAY));
  const five = pickLimit(statuses, "fiveHourPct", "fiveHourResetsAt", now);
  const seven = pickLimit(statuses, "sevenDayPct", "sevenDayResetsAt", now);
  const samples = recordLimitSample(engine.home, five.pct, five.resetsAt, now);
  const limits: Limits = { fiveHourPct: five.pct, fiveHourResetsAt: five.resetsAt, sevenDayPct: seven.pct, sevenDayResetsAt: seven.resetsAt, fullAt: forecastFullAt(samples, now) };
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const today = statuses.filter((s) => s.updatedAt >= midnight && s.costUsd != null);
  const costTodayUsd = today.length ? today.reduce((a, s) => a + s.costUsd!, 0) : null;
  const g = gate(engine.home, env);
  const changes = st?.changes;
  const tipList = tips({
    now,
    builds: w.sessions,
    limits,
    isGit: st?.facts ? st.facts.isGit : null,
    unsaved: changes ? changes.staged.length + changes.unstaged.length + changes.untracked.length : null,
    stuck: (st?.out.issues ?? []).filter((i) => i.key.startsWith("loop:")).map((i) => i.title),
  });
  return {
    connected: !!st?.hooks.installed,
    builds: w.sessions,
    needs: w.needs,
    working: w.working,
    billing,
    limits,
    costTodayUsd,
    tips: tipList,
    plan: { pro: g.allowed && g.licensed, freeLeft: g.allowed ? g.remaining : 0, price: PRICE },
    askCounts: !!st?.hooks.installed && shouldAsk(engine.home),
  };
}

export { FREE_PROMPTS };
