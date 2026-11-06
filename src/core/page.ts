import * as fs from "fs";
import * as path from "path";
import type { Engine, UiState } from "./engine";
import { widgetData, WidgetSession } from "./glance";
import { LiveStatus, readLiveStatus } from "./hooks";
import { FREE_PROMPTS, plan as planOf, PRICE, PRO_POINTS } from "./license";
import { Tip, tips } from "./tips";

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
  /** When the 5-hour limit will be hit at the current pace; null = not enough data, it resets first, or locked (free plan). */
  fullAt: number | null;
  /** The forecast exists but is a Pro feature (free plan after the trial). */
  forecastLocked: boolean;
}
/** A build plus its share of today's usage (from Claude Code's own per-session estimate; Pro). */
export type PageBuild = WidgetSession & { share: number | null };
export interface PageData {
  connected: boolean;
  builds: PageBuild[];
  needs: number;
  working: number;
  billing: Billing;
  limits: Limits;
  /** Claude Code's own list-price estimate, summed over today's builds. Only meaningful for API billing. */
  costTodayUsd: number | null;
  tips: Tip[];
  plan: { pro: boolean; licensed: boolean; trialDaysLeft: number | null; sellable: boolean; freeLeft: number | null; price: string; points: string[] };
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
  const p = planOf(engine.home, env, now);
  const forecast = forecastFullAt(samples, now);
  const limits: Limits = { fiveHourPct: five.pct, fiveHourResetsAt: five.resetsAt, sevenDayPct: seven.pct, sevenDayResetsAt: seven.resetsAt, fullAt: p.pro ? forecast : null, forecastLocked: !p.pro && five.pct != null };
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const today = statuses.filter((s) => s.updatedAt >= midnight && s.costUsd != null);
  const costTodayUsd = today.length ? today.reduce((a, s) => a + s.costUsd!, 0) : null;
  // Share of today's usage per build, from Claude Code's own per-session estimate (a proxy for limit use).
  const costById = new Map(today.map((s) => [s.sessionId, s.costUsd!]));
  const total = [...costById.values()].reduce((a, b) => a + b, 0);
  const builds: PageBuild[] = w.sessions.map((b) => ({ ...b, share: p.pro && total > 0 && costById.has(b.id) ? Math.round((costById.get(b.id)! / total) * 100) : null }));
  const top = builds.filter((b) => b.share != null).sort((a, b) => b.share! - a.share!)[0];
  const changes = st?.changes;
  const tipList = tips({
    now,
    builds,
    limits: { ...limits, fullAt: forecast },
    biggest: top && builds.length > 1 ? { folder: top.folder, share: top.share! } : null,
    isGit: st?.facts ? st.facts.isGit : null,
    unsaved: changes ? changes.staged.length + changes.unstaged.length + changes.untracked.length : null,
    stuck: (st?.out.issues ?? []).filter((i) => i.key.startsWith("loop:")).map((i) => i.title),
  });
  return {
    connected: !!st?.hooks.installed,
    builds,
    needs: w.needs,
    working: w.working,
    billing,
    limits,
    costTodayUsd,
    tips: tipList,
    plan: { pro: p.pro, licensed: p.licensed, trialDaysLeft: p.trialDaysLeft, sellable: p.sellable, freeLeft: p.freeLeft, price: PRICE, points: PRO_POINTS },
  };
}

export { FREE_PROMPTS };
