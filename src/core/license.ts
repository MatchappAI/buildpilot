import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

/**
 * BuildPilot plans. Watching builds, plan limits, tips, terminal/plugin/menu bar: free forever.
 * Pro ($9/mo): limit forecast + what's using your limit, unlimited parallel builds, unlimited prompts.
 * - Everyone gets a 14-day trial of Pro from first run (a "reverse trial": feel it, then decide).
 * - Nothing is ever blocked while Pro isn't on sale (no real checkout link configured).
 * - Usage: <home>/usage.json (prompts used, first run, random install id).
 * - License: BUILDPILOT_LICENSE_KEY / BUILDPILOT_AUTH_TOKEN env, or <home>/license.json.
 *   Keys are Ed25519-signed ("BP1.<payload>.<sig>"), verified offline; only the issuer's private key
 *   (kept outside this repo, and as a secret in the license Worker) can mint them.
 */

export const FREE_PROMPTS = 20;
/** Free users can run one extra build side by side (two at once); more needs Pro. */
export const FREE_EXTRA_BUILDS = 1;
export const TRIAL_DAYS = 14;
export const PRICE = "$9/mo";
export const PRO_POINTS = ["See when you'll run out, and which build is using your limit", "Run as many builds at once as you like (free: 2)", "Unlimited prompts (free: 20)"];
/** Stripe Payment Link. Replace with the real buy.stripe.com link; BUILDPILOT_CHECKOUT_URL overrides. */
export const CHECKOUT_URL = "https://buy.stripe.com/REPLACE_WITH_PAYMENT_LINK";

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA7wNACNiV5ED9mb6g4/V+y3lZAcKXKI/1F/FzIjVrLTQ=
-----END PUBLIC KEY-----`;

export interface License { valid: boolean; plan?: string; sub?: string; source?: "env" | "file"; reason?: string }
export interface Usage { installId: string; count: number; firstRun: number }
export interface Paywall { message: string; url: string; used: number; limit: number }
export interface Plan {
  /** Pro features unlocked right now (paid, in trial, or Pro not on sale yet). */
  pro: boolean;
  licensed: boolean;
  /** Days left in the free trial (null = not in trial). */
  trialDaysLeft: number | null;
  /** Pro can actually be bought (a real checkout link is configured). */
  sellable: boolean;
  freeLeft: number | null;
}
export type Gate = { allowed: true; licensed: boolean; remaining: number | null } | { allowed: false; paywall: Paywall };

const usagePath = (home: string) => path.join(home, "usage.json");
const licensePath = (home: string) => path.join(home, "license.json");
const DAY = 86_400_000;

function readJson<T>(file: string): Partial<T> {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Partial<T>;
  } catch {
    return {};
  }
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function readUsage(home: string, now = Date.now()): Usage {
  const u = readJson<Usage>(usagePath(home));
  const idOk = typeof u.installId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(u.installId);
  const usage: Usage = {
    installId: idOk ? u.installId! : crypto.randomUUID(),
    count: Number.isInteger(u.count) && u.count! >= 0 ? u.count! : 0,
    firstRun: typeof u.firstRun === "number" && u.firstRun > 0 && u.firstRun <= now ? u.firstRun : now,
  };
  if (!idOk || usage.firstRun !== u.firstRun) writeJson(usagePath(home), usage);
  return usage;
}

export function verifyKey(key: string, publicKey = PUBLIC_KEY): License {
  const m = /^BP1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(key.trim());
  if (!m) return { valid: false, reason: "not a BuildPilot key" };
  const [, body, sig] = m as unknown as [string, string, string];
  try {
    const ok = crypto.verify(null, Buffer.from(`BP1.${body}`), publicKey, Buffer.from(sig, "base64url"));
    if (!ok) return { valid: false, reason: "signature doesn't match" };
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { sub?: string; plan?: string; exp?: number };
    if (p.exp && Date.now() > p.exp) return { valid: false, reason: "expired" };
    return { valid: true, plan: String(p.plan ?? "pro"), sub: String(p.sub ?? "") };
  } catch {
    return { valid: false, reason: "unreadable key" };
  }
}

export function readLicense(home: string, env: NodeJS.ProcessEnv = process.env): License {
  const fromEnv = env.BUILDPILOT_LICENSE_KEY || env.BUILDPILOT_AUTH_TOKEN;
  if (fromEnv) return { ...verifyKey(fromEnv), source: "env" };
  const key = readJson<{ key: string }>(licensePath(home)).key;
  if (typeof key === "string" && key) return { ...verifyKey(key), source: "file" };
  return { valid: false, reason: "no key" };
}

/** Validates then saves the key to <home>/license.json. Returns the verdict; invalid keys are not saved. */
export function saveLicense(home: string, key: string): License {
  const v = verifyKey(key);
  if (v.valid) writeJson(licensePath(home), { key: key.trim() });
  return v;
}

const checkoutBase = (env: NodeJS.ProcessEnv) => env.BUILDPILOT_CHECKOUT_URL || CHECKOUT_URL;
export const sellable = (env: NodeJS.ProcessEnv = process.env) => !checkoutBase(env).includes("REPLACE");

/** The random install id lets the license Worker match a payment to a key. It identifies nothing else. */
export function checkoutUrl(installId: string, env: NodeJS.ProcessEnv = process.env): string {
  const u = new URL(checkoutBase(env));
  u.searchParams.set("client_reference_id", installId);
  return u.toString();
}

export function plan(home: string, env: NodeJS.ProcessEnv = process.env, now = Date.now()): Plan {
  const licensed = readLicense(home, env).valid;
  const u = readUsage(home, now);
  const trialDays = env.BUILDPILOT_TRIAL_DAYS != null ? Number(env.BUILDPILOT_TRIAL_DAYS) : TRIAL_DAYS;
  const left = Math.ceil((u.firstRun + trialDays * DAY - now) / DAY);
  const trialDaysLeft = !licensed && left > 0 ? left : null;
  const canBuy = sellable(env);
  const pro = licensed || trialDaysLeft != null || !canBuy;
  return { pro, licensed, trialDaysLeft, sellable: canBuy, freeLeft: pro ? null : Math.max(0, FREE_PROMPTS - u.count) };
}

function paywallFor(home: string, env: NodeJS.ProcessEnv, used: number, limit: number, what: string): Paywall {
  const url = checkoutUrl(readUsage(home).installId, env);
  return { url, used, limit, message: `${what} Go unlimited for ${PRICE}: ${url}` };
}

export function gate(home: string, env: NodeJS.ProcessEnv = process.env): Gate {
  const p = plan(home, env);
  if (p.pro) return { allowed: true, licensed: true, remaining: null };
  const u = readUsage(home);
  if (u.count < FREE_PROMPTS) return { allowed: true, licensed: false, remaining: FREE_PROMPTS - u.count };
  return { allowed: false, paywall: paywallFor(home, env, u.count, FREE_PROMPTS, `You've used your ${FREE_PROMPTS} free prompts.`) };
}

/** Parallel builds: free users get FREE_EXTRA_BUILDS side-by-side copies; Pro is unlimited. */
export function gateParallel(home: string, extraBuilds: number, env: NodeJS.ProcessEnv = process.env): { allowed: true } | { allowed: false; paywall: Paywall } {
  if (extraBuilds < FREE_EXTRA_BUILDS || plan(home, env).pro) return { allowed: true };
  return { allowed: false, paywall: paywallFor(home, env, extraBuilds, FREE_EXTRA_BUILDS, `The free plan runs ${FREE_EXTRA_BUILDS + 1} builds at once.`) };
}

/** Call only when a prompt is actually used (sent or copied). No-op when Pro features are unlocked. */
export function recordUse(home: string, env: NodeJS.ProcessEnv = process.env): number | null {
  if (plan(home, env).pro) return null;
  const u = readUsage(home);
  u.count += 1;
  writeJson(usagePath(home), u);
  return Math.max(0, FREE_PROMPTS - u.count);
}

/** Terminal paywall: short and scannable. */
export function paywallText(p: Paywall): string {
  return [p.message, "", ...PRO_POINTS.map((x) => `  + ${x}`), "  Watching builds, limits and tips stays free. Separate from your Claude plan. Cancel anytime.", "  Already paid?  bp license <your-key>"].join("\n");
}
