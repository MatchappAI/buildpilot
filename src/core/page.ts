import * as fs from "fs";
import * as path from "path";
import type { Engine, UiState } from "./engine";
import { widgetData, WidgetSession } from "./glance";
import { LiveStatus, pluginConnected, readLiveStatus } from "./hooks";
import { FREE_PROMPTS, plan as planOf, PRICE, PRO_POINTS } from "./license";
import { Tip, tips } from "./tips";
import { codexSessions } from "./codex";
import { TokenItem, tokenReport } from "./tokens";

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
  /** Minutes of history the forecast is based on. */
  basisMin?: number | null;
  /** How accurate past forecasts were (null until at least one window was graded). */
  accuracy?: string | null;
  /** Weekly usage so far, one point per day of the current week. */
  week?: WeekDay[];
  /** When the weekly limit runs out at this pace, if before the reset. */
  weekFullAt?: number | null;
  /** Codex's own limits, when its logs report them. */
  codex?: { primaryPct: number | null; secondaryPct: number | null; resetsAt: number | null } | null;
}
/** A build plus its share of today's usage (from Claude Code's own per-session estimate; Pro). */
export interface BuildTokens { baseline: number | null; context: number | null; inputTotal?: number; output: number; turns: number; models: [string, number][]; subagents: number; compactions: number; top: TokenItem[] | null }
export type PageBuild = WidgetSession & { share: number | null; costUsd?: number | null; tokens?: BuildTokens | null; codexTokens?: number | null };
export interface WeekDay { day: string; pct: number }
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
  /** BuildPilot side builds (worktrees) with their changes; filled in by the extension. */
  side?: { name: string; dir: string; branch: string; changed: number; unsaved: number; commits: number }[];
  plan: { pro: boolean; licensed: boolean; trialDaysLeft: number | null; trialEndsAt?: number | null; sellable: boolean; freeLeft: number | null; price: string; points: string[] };
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
/** One finished 5-hour window: did the forecast get it right? */
export interface WindowResult { endedAt: number; hit: boolean; errorMin: number | null; falseAlarm: boolean }
export interface SampleFile { resetsAt: number | null; samples: [number, number][]; forecasts?: [number, number][]; history?: WindowResult[] }

/** Grade a finished window: compare forecasts made 20–90 min before the limit was hit with when it really was. */
export function gradeWindow(f: SampleFile, endedAt: number): WindowResult | null {
  const preds = f.forecasts ?? [];
  if (!preds.length) return null;
  const hitAt = f.samples.find(([, p]) => p >= 99)?.[0] ?? null;
  if (hitAt == null) return { endedAt, hit: false, errorMin: null, falseAlarm: preds.some(([made, at]) => at < (f.resetsAt ?? endedAt) && at - made < 60 * 60_000) };
  const near = preds.filter(([made]) => made <= hitAt - 20 * 60_000 && made >= hitAt - 90 * 60_000);
  if (!near.length) return { endedAt, hit: true, errorMin: null, falseAlarm: false };
  const err = near.reduce((a, [, at]) => a + Math.abs(at - hitAt), 0) / near.length / 60_000;
  return { endedAt, hit: true, errorMin: Math.round(err), falseAlarm: false };
}

/** Plain summary of past accuracy, or null until there's evidence. */
export function accuracyText(history: WindowResult[] | undefined): string | null {
  const graded = (history ?? []).filter((h) => h.errorMin != null);
  if (!graded.length) return null;
  const errs = graded.map((h) => h.errorMin!).sort((a, b) => a - b);
  const median = errs[Math.floor(errs.length / 2)]!;
  return `Past forecasts were off by about ${median} min (${graded.length} window${graded.length === 1 ? "" : "s"}).`;
}
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
  // A new window (different reset time, or usage dropped) starts a fresh series; grade the old one first.
  const last = f.samples[f.samples.length - 1];
  if ((resetsAt != null && f.resetsAt != null && Math.abs(resetsAt - f.resetsAt) > 60_000) || (last && pct < last[1] - 1)) {
    const g = gradeWindow(f, now);
    f = { resetsAt, samples: [], forecasts: [], history: [...(f.history ?? []), ...(g ? [g] : [])].slice(-10) };
  }
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

/** Remember what we predicted (at most every 5 minutes) so the window can be graded later. */
export function recordForecast(home: string, f: SampleFile, fullAt: number | null, now: number): void {
  if (fullAt == null) return;
  const fc = (f.forecasts ??= []);
  const last = fc[fc.length - 1];
  if (last && now - last[0] < 5 * 60_000) return;
  fc.push([now, fullAt]);
  f.forecasts = fc.slice(-80);
  try {
    fs.writeFileSync(samplesPath(home), JSON.stringify(f));
  } catch {
    /* read-only */
  }
}

/** Least-squares line through the samples. Needs ≥3 points over ≥10 minutes and rising usage. */
export function forecastFullAt(f: SampleFile, now: number): number | null {
  const s = f.samples;
  if (s.length < 3 || s[s.length - 1]![0] - s[0]![0] < 10 * 60_000) return null;
  const n = s.length;
  // Weighted least squares: recent minutes count more (half-life 12 min), so the forecast reacts when you
  // start or stop a big job instead of averaging the whole window.
  const tEnd = s[n - 1]![0];
  const w = s.map(([t]) => Math.pow(0.5, (tEnd - t) / (12 * 60_000)));
  const W = w.reduce((a, b) => a + b, 0);
  const mx = s.reduce((a, [t], i) => a + w[i]! * t, 0) / W;
  const my = s.reduce((a, [, p], i) => a + w[i]! * p, 0) / W;
  let num = 0;
  let den = 0;
  s.forEach(([t, p], i) => {
    num += w[i]! * (t - mx) * (p - my);
    den += w[i]! * (t - mx) ** 2;
  });
  const slope = den ? num / den : 0; // % per ms
  const lastPct = s[n - 1]![1];
  if (slope <= 0 || lastPct >= 100) return lastPct >= 100 ? now : null;
  const at = now + (100 - lastPct) / slope;
  if (f.resetsAt && at >= f.resetsAt) return null; // resets before it runs out
  return at;
}

// ---------- weekly history ----------
const histPath = (home: string) => path.join(home, "limit-history.json");
/** Keep the latest weekly % per day (14 days) and return this week's points. */
export function recordWeek(home: string, sevenPct: number | null, resetsAt: number | null, now: number): { week: WeekDay[]; weekFullAt: number | null } {
  let h: Record<string, number> = {};
  try { h = JSON.parse(fs.readFileSync(histPath(home), "utf8")) as Record<string, number>; } catch { /* first run */ }
  const key = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  if (sevenPct != null) {
    h[key(now)] = sevenPct;
    const keep = Object.keys(h).sort().slice(-14);
    h = Object.fromEntries(keep.map((k) => [k, h[k]!]));
    try { fs.writeFileSync(histPath(home), JSON.stringify(h)); } catch { /* read-only */ }
  }
  if (!resetsAt) return { week: [], weekFullAt: null };
  const start = resetsAt - 7 * DAY;
  const week: WeekDay[] = [];
  for (let t = start; t <= now; t += DAY) {
    const v = h[key(t)];
    if (typeof v === "number") week.push({ day: key(t) === key(now) ? "Today" : new Date(t).toLocaleDateString([], { weekday: "short" }), pct: v });
  }
  // Pace for the week: straight line from the window start to now.
  let weekFullAt: number | null = null;
  if (sevenPct != null && sevenPct > 0 && now > start) {
    const at = start + (100 / sevenPct) * (now - start);
    if (at < resetsAt) weekFullAt = at;
  }
  return { week, weekFullAt };
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
  recordForecast(engine.home, samples, forecast, now);
  const wk = recordWeek(engine.home, seven.pct, seven.resetsAt, now);
  const cx = codexSessions(now);
  const cxLim = cx.find((c) => c.limits)?.limits ?? null;
  const limits: Limits = { week: wk.week, weekFullAt: wk.weekFullAt, codex: cxLim, fiveHourPct: five.pct, fiveHourResetsAt: five.resetsAt, sevenDayPct: seven.pct, sevenDayResetsAt: seven.resetsAt, fullAt: forecast, forecastLocked: false, accuracy: accuracyText(samples.history), basisMin: samples.samples.length >= 2 ? Math.round((samples.samples[samples.samples.length - 1]![0] - samples.samples[0]![0]) / 60_000) : null };
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  // Every build that ran today (not just the last few hours), so shares add up to the whole day.
  const today = recentStatuses(engine.home, now, Math.max(1, now - midnight)).filter((s) => s.costUsd != null);
  const costTodayUsd = today.length ? today.reduce((a, s) => a + s.costUsd!, 0) : null;
  // Share of today's usage per build, from Claude Code's own per-session estimate (a proxy for limit use).
  const costById = new Map(today.map((s) => [s.sessionId, s.costUsd!]));
  const total = [...costById.values()].reduce((a, b) => a + b, 0);
  const tPaths = new Map(engine.store.all<{ id: string; transcript_path: string | null }>("SELECT id, transcript_path FROM sessions WHERE last_event_at > ?", [now - 12 * 3600_000]).map((r) => [r.id, r.transcript_path]));
  const tokensFor = (id: string): BuildTokens | null => {
    const r = tokenReport(tPaths.get(id) ?? null);
    if (!r || !r.turns) return null;
    // Totals are free; the per-item breakdown (what exactly burned it) is Pro.
    return { baseline: r.baseline, context: r.context, inputTotal: r.inputTotal, output: r.output, turns: r.turns, models: r.models, subagents: r.subagents, compactions: r.compactions, top: p.pro ? r.top : null };
  };
  const builds: PageBuild[] = [
    ...w.sessions.map((b) => ({ ...b, share: (p.pro || billing === "api") && total > 0 && costById.has(b.id) ? Math.round((costById.get(b.id)! / total) * 100) : null, costUsd: billing === "api" ? costById.get(b.id) ?? null : null, tokens: tokensFor(b.id) })),
    ...cx.map((c) => ({ ...c, share: null, costUsd: null, tokens: null, codexTokens: c.tokens })),
  ];
  const top = builds.filter((b) => b.share != null).sort((a, b) => b.share! - a.share!)[0];
  const changes = st?.changes;
  const tipList = tips({
    now,
    builds,
    limits,
    biggest: top && builds.length > 1 ? { folder: top.folder, share: top.share!, cwd: top.cwd } : null,
    isGit: st?.facts ? st.facts.isGit : null,
    unsaved: changes ? changes.staged.length + changes.unstaged.length + changes.untracked.length : null,
    stuck: (st?.out.issues ?? []).filter((i) => i.key.startsWith("loop:")).map((i) => i.title),
    weekFullAt: wk.weekFullAt,
    claudeMdTokens: claudeMdTokens(st?.project?.root ?? null),
  });
  return {
    connected: !!st?.hooks.installed || pluginConnected(),
    builds,
    needs: w.needs,
    working: w.working + cx.filter((c) => c.status === "running").length,
    billing,
    limits,
    costTodayUsd,
    tips: tipList,
    plan: { pro: p.pro, licensed: p.licensed, trialDaysLeft: p.trialDaysLeft, trialEndsAt: p.trialDaysLeft != null ? now + p.trialDaysLeft * DAY : null, sellable: p.sellable, freeLeft: p.freeLeft, price: PRICE, points: PRO_POINTS },
  };
}

/** Rough size of the project's CLAUDE.md files (they're sent with every message). */
export function claudeMdTokens(root: string | null): number | null {
  if (!root) return null;
  let chars = 0;
  for (const f of ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"]) {
    try { chars += fs.statSync(path.join(root, f)).size; } catch { /* missing */ }
  }
  return chars ? Math.round(chars / 4) : null;
}

export { FREE_PROMPTS };
